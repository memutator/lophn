import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CallFrom,
  type CallRef,
  callFromOfRow,
} from "../../../protocol/lophn-agent/calls.ts";
import {
  type AgentId,
  DEFAULT_PERMISSION_MODE,
  type HarnessRuntime,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
  type PermissionMode,
  type ReceivedMessage,
  type Workspace,
  type WorkspaceSession,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  SchemaStep,
  SqlParams,
  SqlRow,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";

// 본문 blob은 영구 보존이다. 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람,
// 그 session의 agent, machine)는 ReadMessageBody가 판정한다. 이미지도 같다. 그 session의 메시지가 참조하는 것만
// ReadMessageImage·ResolveMessageImage가 연다.
export const messageBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    field: MESSAGE_BODY_FIELD,
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    field: MESSAGE_IMAGE_FIELD,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

// sessions·messages 표와 row 변환. 순수 함수와 읽기 조회만 있다. 상태 전이 규칙은 commands.ts, 읽기는
// reads.ts가 맡는다. 본문은 열에 없고 hash만 남는다. session의 agent와 workspace와 출처는 바뀌지
// 않고, archive한 session은 다시 열리지 않는다. 두 표의 순번(created_seq, state_seq)은 ledger event
// 없이 표 안에서 이어 센다. 가져간 메시지의 본문·봉투·순서는 덮어쓰지 않고, 아직 turn이
// 가져가지 않은 사람 메시지의 본문과 순서만 큐에서 고친다. session과 메시지는
// DeleteSession만 지운다.
export const conversationSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.sessions.tables",
    sql: `
create table sessions (
  id text primary key,
  agent text not null,
  project text,
  app text,
  place_kind text check (place_kind is null or place_kind in ('project', 'app')),
  place_id text,
  title text check (title is null or length(trim(title)) > 0),
  lifecycle text not null default 'open' check (lifecycle in ('open', 'archived')),
  forked_from_session text,
  forked_from_through_seq integer,
  model_selection text check (model_selection is null or json_valid(model_selection)),
  compaction_through_seq integer,
  compaction_summary_call text,
  skip integer not null default 0 check (skip in (0, 1)),
  created_seq integer not null check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((place_kind is null) = (place_id is null)),
  check (project is (case when place_kind = 'project' then place_id end)),
  check (app is (case when place_kind = 'app' then place_id end)),
  check ((forked_from_session is null) = (forked_from_through_seq is null)),
  check (forked_from_session is null or forked_from_session != id),
  check ((compaction_through_seq is null) = (compaction_summary_call is null))
) strict;
create index sessions_agent on sessions (agent, place_kind, place_id, lifecycle);
create trigger sessions_identity_immutable
before update of id, agent, project, app, place_kind, place_id,
  forked_from_session, forked_from_through_seq,
  created_seq on sessions
begin
  select raise(abort, 'session identity is immutable');
end;
create trigger sessions_archived_terminal
before update of lifecycle on sessions
when old.lifecycle = 'archived' and new.lifecycle != 'archived'
begin
  select raise(abort, 'an archived session is never reopened');
end;
create table messages (
  id text primary key,
  session text not null references sessions (id) on delete restrict,
  from_kind text not null check (from_kind in ('human', 'program', 'agent')),
  from_ref text,
  call text,
  reply_to text,
  refs text not null default '[]' check (json_valid(refs)),
  reply text check (reply in ('none', 'result', 'conversation')),
  event text,
  fail_reason text check (fail_reason in ('not_found', 'closed', 'receiver_ended', 'lophn_restarted')),
  delivery text not null default 'next_turn' check (delivery in ('next_turn', 'steer')),
  unattended integer not null default 0 check (unattended in (0, 1)),
  step_instance text,
  step_name text,
  turn text,
  body text not null check (length(body) = 64),
  created_seq integer not null unique check (created_seq >= 1),
  created_at text not null,
  state_seq integer not null check (state_seq >= created_seq),
  check ((from_kind in ('human', 'program')) = (from_ref is null)),
  check (delivery = 'next_turn' or from_kind = 'human'),
  check (unattended = 0 or from_kind = 'human'),
  check ((step_instance is null) = (step_name is null)),
  check (step_instance is null or from_kind = 'program')
) strict;
create index messages_session_created on messages (session, created_seq);
create index messages_turn on messages (turn);
create trigger messages_content_immutable
before update of id, session, from_kind, from_ref, call, reply_to, refs,
  reply, event, fail_reason, delivery, unattended, step_instance, step_name, body, created_seq, created_at on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
create trigger messages_turn_fixed
before update of turn on messages
when old.turn is not null
begin
  select raise(abort, 'the turn that took a message is fixed');
end;
create table session_compact_requests (
  request_seq integer primary key check (request_seq >= 1),
  session text not null references sessions (id) on delete restrict,
  state text not null check (state in ('requested', 'compacted', 'failed')),
  failure text,
  check ((state = 'failed') = (failure is not null))
) strict;
create unique index session_compact_requests_open
  on session_compact_requests (session) where state = 'requested';`,
  },
  {
    // 아직 turn이 가져가지 않은 사람 메시지는 큐에서 글을 고치거나 순서를 바꿀 수 있다.
    // 확정(가져간) 메시지의 본문·봉투·순서는 그대로 고정이다.
    id: "lophn-agent.messages.queued-edit",
    sql: `
drop trigger messages_content_immutable;
create trigger messages_content_immutable
before update of id, session, from_kind, from_ref, call, reply_to, refs,
  reply, event, fail_reason, delivery, unattended, step_instance, step_name, created_at on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
create trigger messages_body_fixed
before update of body on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn'
begin
  select raise(abort, 'a consumed message body is fixed');
end;
create trigger messages_created_seq_fixed
before update of created_seq on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn'
begin
  select raise(abort, 'the order of a consumed message is fixed');
end;`,
  },
  {
    // harness runtime의 session은 열 때 정한 harness를 바꾸지 못한다. harness_session은 그 harness가 알려 준
    // 자기 session id이고 다음 turn과 TUI 열기가 같은 id로 이어 간다.
    id: "lophn-agent.sessions.harness",
    sql: `
alter table sessions add column harness text
  check (harness is null or harness in ('claude-code', 'codex', 'opencode'));
alter table sessions add column harness_session text
  check (harness_session is null or (harness is not null and length(harness_session) > 0));
create trigger sessions_harness_immutable
before update of harness on sessions
begin
  select raise(abort, 'session harness is immutable');
end;`,
  },
  {
    // 다른 workspace의 session이 불러 열린 session은 부른 workspace를 남긴다(home 세션의 읽기 범위를 좁히는 근거).
    id: "lophn-agent.sessions.called-from",
    sql: `
alter table sessions add column called_from_kind text
  check (called_from_kind is null or called_from_kind in ('project', 'app'));
alter table sessions add column called_from_id text
  check ((called_from_kind is null) = (called_from_id is null));
create trigger sessions_called_from_immutable
before update of called_from_kind, called_from_id on sessions
begin
  select raise(abort, 'session call origin is immutable');
end;`,
  },
  {
    // place를 workspace로 부르게 됐다. rename column은 check, index, trigger의 이름도 같이 고친다.
    id: "lophn-agent.sessions.workspace",
    sql: `
alter table sessions rename column place_kind to workspace_kind;
alter table sessions rename column place_id to workspace_id;`,
  },
  {
    // 사람이 `!`로 돌린 명령의 기록이다. 사람 메시지로 쓰되 queue에 넣지 않고 turn을 열지 않는다. 다음 turn이
    // 가져가 model이 본다. 가져간 뒤의 본문·순서는 다른 메시지처럼 고정이고, 가져가기 전에도 글을 고치거나
    // 순서를 바꾸지 못한다(대기열 메시지가 아니다).
    id: "lophn-agent.messages.shell",
    sql: `
alter table messages add column shell integer not null default 0 check (shell in (0, 1));
create trigger messages_shell_human_only
before insert on messages
when new.shell = 1 and (new.from_kind != 'human' or new.delivery != 'next_turn')
begin
  select raise(abort, 'only a human next-turn message can be a shell record');
end;
drop trigger messages_content_immutable;
create trigger messages_content_immutable
before update of id, session, from_kind, from_ref, call, reply_to, refs,
  reply, event, fail_reason, delivery, unattended, step_instance, step_name, shell, created_at on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
drop trigger messages_body_fixed;
create trigger messages_body_fixed
before update of body on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn' or old.shell = 1
begin
  select raise(abort, 'a consumed message body is fixed');
end;
drop trigger messages_created_seq_fixed;
create trigger messages_created_seq_fixed
before update of created_seq on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn' or old.shell = 1
begin
  select raise(abort, 'the order of a consumed message is fixed');
end;`,
  },
  {
    // `team spawn`으로 열린 session은 연 session을 남긴다(팀은 이 spawn tree다). FK는 없다: 사람이 부모를 지워도 자식은 남는다.
    id: "lophn-agent.sessions.spawned-by",
    sql: `
alter table sessions add column spawned_by text;
create trigger sessions_spawned_by_immutable
before update of spawned_by on sessions
begin
  select raise(abort, 'session spawn origin is immutable');
end;`,
  },
];

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export type AgentSessionRow = {
  id: string;
  agent: AgentId;
  project: string | null;
  app: string | null;
  workspace_kind: "project" | "app" | null;
  workspace_id: string | null;
  title: string | null;
  lifecycle: "open" | "archived";
  forked_from_session: string | null;
  forked_from_through_seq: string | null;
  model_selection: string | null;
  compaction_through_seq: string | null;
  compaction_summary_call: string | null;
  permission_mode: PermissionMode;
  // runtime이 harness인 agent의 session이면 그 harness. 열 때 정해 바뀌지 않는다.
  harness: HarnessRuntime | null;
  harness_session: string | null;
  // 터미널 GUI 탭의 팀원 session이다. turn은 그 탭이 돌리고 headless host가 가져가지 않는다. 열 때 정해 바뀌지 않는다.
  harness_gui: boolean;
  // 다른 workspace의 session이 불러 열렸으면 그 workspace. 열 때 정해 바뀌지 않는다.
  called_from_kind: "project" | "app" | null;
  called_from_id: string | null;
  // `team spawn`으로 열렸으면 연 session. 열 때 정해 바뀌지 않는다.
  spawned_by: string | null;
  // 앱이 열었으면 그 앱. 앱은 자기가 연 session만 끝낼 수 있고 알림 규칙이 turn 끝 알림을 거른다. 열 때 정해 바뀌지 않는다.
  opened_by_app: string | null;
  // 다른 컴퓨터에서 온 mail이 열었으면 그 기계(`mch_`). 그 session은 다른 컴퓨터로 보내지 못한다. 열 때 정해 바뀌지 않는다.
  opened_by_machine: string | null;
  // 다른 컴퓨터에 연 팀원의 행이면 그 기계(`mch_`). turn은 그 기계에서 돌고 이 행은 팀 tree의 자리다. 열 때 정해 바뀌지 않는다.
  runs_on: string | null;
  // 이 session이 속한 workflow instance와 step(JSON `{ project, workflow, instance, step }`). workflow가 step을 넘길 때마다 갱신하고
  // `team spawn` 자식은 열 때 부모 것을 이어받는다. 다른 열과 달리 열린 뒤에도 바뀐다.
  workflow_origin: string | null;
  created_seq: string;
  state_seq: string;
};
// 다른 단위가 이 이름으로 import한다.
export type SessionRow = AgentSessionRow;

export const SESSION_COLUMNS = `id, agent, project, app, workspace_kind,
  workspace_id, title, lifecycle, forked_from_session, forked_from_through_seq,
  model_selection, compaction_through_seq,
  compaction_summary_call, permission_mode, harness, harness_session, harness_gui, called_from_kind, called_from_id, spawned_by, opened_by_app, opened_by_machine, runs_on, workflow_origin, created_seq, state_seq`;

export function sessionRowOf(row: SqlRow): AgentSessionRow {
  return {
    id: String(row["id"]),
    agent: String(row["agent"]) as AgentId,
    project: text(row["project"]),
    app: text(row["app"]),
    workspace_kind: text(
      row["workspace_kind"],
    ) as AgentSessionRow["workspace_kind"],
    workspace_id: text(row["workspace_id"]),
    title: text(row["title"]),
    lifecycle: String(row["lifecycle"]) as AgentSessionRow["lifecycle"],
    forked_from_session: text(row["forked_from_session"]),
    forked_from_through_seq: text(row["forked_from_through_seq"]),
    model_selection: text(row["model_selection"]),
    compaction_through_seq: text(row["compaction_through_seq"]),
    compaction_summary_call: text(row["compaction_summary_call"]),
    permission_mode: (text(row["permission_mode"]) ??
      DEFAULT_PERMISSION_MODE) as PermissionMode,
    harness: text(row["harness"]) as HarnessRuntime | null,
    harness_session: text(row["harness_session"]),
    harness_gui: Number(row["harness_gui"]) === 1,
    called_from_kind: text(
      row["called_from_kind"],
    ) as AgentSessionRow["called_from_kind"],
    called_from_id: text(row["called_from_id"]),
    spawned_by: text(row["spawned_by"]),
    opened_by_app: text(row["opened_by_app"]),
    opened_by_machine: text(row["opened_by_machine"]),
    runs_on: text(row["runs_on"]),
    workflow_origin: text(row["workflow_origin"]),
    created_seq: String(row["created_seq"]),
    state_seq: String(row["state_seq"]),
  };
}

export function loadSession(
  lookup: Lookup,
  id: string,
): AgentSessionRow | undefined {
  const row = lookup.sql.get(
    `select ${SESSION_COLUMNS} from sessions where id = ?`,
    [id],
  );
  return row === undefined ? undefined : sessionRowOf(row);
}

// 이 컴퓨터에서 도는 session. 다른 컴퓨터에서 도는 팀원의 자리(`runs_on`)는 대화, model, 기록이 그 컴퓨터에 있어 session id로 하나를
// 다루는 길(읽기, 이름, model, fork)에서 없는 session과 같다.
export function loadLocalSession(
  lookup: Lookup,
  id: string,
): AgentSessionRow | undefined {
  const row = loadSession(lookup, id);
  return row?.runs_on === null ? row : undefined;
}

// 앱 workspace의 session 전부(archive한 것도). 앱을 지울 때 지운다.
export function appWorkspaceSessions(
  lookup: {
    sql: { all: (query: string, params: SqlParams) => SqlRow[] };
  },
  app: string,
): AgentSessionRow[] {
  return lookup.sql
    .all(
      `select ${SESSION_COLUMNS} from sessions where app = ? order by created_seq`,
      [app],
    )
    .map(sessionRowOf);
}

// 열린 session 전부. archive한 session은 빼고 연 순서다.
export function openSessions(lookup: {
  sql: { all: (query: string, params: SqlParams) => SqlRow[] };
}): AgentSessionRow[] {
  return lookup.sql
    .all(
      `select ${SESSION_COLUMNS} from sessions where lifecycle = 'open' order by created_seq`,
      [],
    )
    .map(sessionRowOf);
}

// 열린 팀원으로 이어진 다른 컴퓨터들: 이 컴퓨터의 팀원이 도는 곳(`team spawn --on`의 자리)과 이 컴퓨터의 팀원 session을 연 곳.
export function memberMachines(lookup: {
  sql: { all: (query: string, params: SqlParams) => SqlRow[] };
}): string[] {
  return lookup.sql
    .all(
      `select runs_on as machine from sessions where runs_on is not null and lifecycle = 'open'
       union select opened_by_machine from sessions
       where opened_by_machine is not null and spawned_by is not null and lifecycle = 'open'`,
      [],
    )
    .map((row) => String(row["machine"]));
}

export function workspaceOf(row: AgentSessionRow): Workspace | null {
  return row.workspace_kind === null || row.workspace_id === null
    ? null
    : ({ kind: row.workspace_kind, id: row.workspace_id } as Workspace);
}

export function calledFromOf(row: AgentSessionRow): Workspace | null {
  return row.called_from_kind === null || row.called_from_id === null
    ? null
    : ({ kind: row.called_from_kind, id: row.called_from_id } as Workspace);
}

// 같은 agent와 workspace의 session인지 가르는 조건.
export function sessionClause(
  agent: AgentId,
  workspace: Workspace | null,
): {
  sql: string;
  params: (string | null)[];
} {
  return {
    sql: "agent = ? and workspace_kind is ? and workspace_id is ?",
    params: [agent, workspace?.kind ?? null, workspace?.id ?? null],
  };
}

export function modelSelectionOf(
  row: AgentSessionRow,
): WorkspaceSession["model_selection"] {
  return row.model_selection === null
    ? null
    : (JSON.parse(row.model_selection) as WorkspaceSession["model_selection"]);
}

export function workspaceSessionOf(row: AgentSessionRow): WorkspaceSession {
  return {
    id: row.id,
    agent: row.agent,
    workspace: workspaceOf(row),
    title: row.title,
    lifecycle: row.lifecycle,
    forked_from:
      row.forked_from_session === null || row.forked_from_through_seq === null
        ? null
        : {
            session: row.forked_from_session,
            through_seq: row.forked_from_through_seq,
          },
    model_selection: modelSelectionOf(row),
    compaction:
      row.compaction_through_seq === null ||
      row.compaction_summary_call === null
        ? null
        : {
            through_seq: row.compaction_through_seq,
            summary_call: row.compaction_summary_call,
          },
    permission_mode: row.permission_mode,
    called_from: calledFromOf(row),
    spawned_by: row.spawned_by as WorkspaceSession["spawned_by"],
    opened_by_app: row.opened_by_app as WorkspaceSession["opened_by_app"],
    harness: row.harness,
    state_seq: row.state_seq,
  } as WorkspaceSession;
}

// session 표의 다음 순번이다. 세션을 열 때 created_seq와 state_seq가 같고 바뀔 때마다 이어 센다.
export function nextSessionSeq(lookup: Lookup): number {
  const row = lookup.sql.get(
    "select coalesce(max(state_seq), 0) + 1 as next from sessions",
    [],
  );
  return row === undefined ? 1 : Number(row["next"]);
}

// messages 표의 다음 created_seq다.
export function nextMessageSeq(lookup: Lookup): number {
  const row = lookup.sql.get(
    "select coalesce(max(created_seq), 0) + 1 as next from messages",
    [],
  );
  return row === undefined ? 1 : Number(row["next"]);
}

type MessageRow = {
  id: string;
  session: string;
  from_kind: CallFrom["kind"];
  from_ref: string | null;
  call: string | null;
  reply_to: string | null;
  refs: string;
  reply: "none" | "result" | "conversation" | null;
  event: string | null;
  fail_reason: ReceivedMessage["fail_reason"];
  delivery: "next_turn" | "steer";
  step_instance: string | null;
  step_name: string | null;
  shell: boolean;
  // 앱 화면이 보낸 사람 메시지의 이름표(`<앱 id>|<slug>`). 보낸 쪽이 아니다.
  origin_app: string | null;
  turn: string | null;
  body: string;
  created_seq: string;
  created_at: string;
  state_seq: string;
};

export const MESSAGE_COLUMNS = `id, session, from_kind, from_ref, call,
  reply_to, refs, reply, event, fail_reason, delivery, step_instance, step_name, shell, origin_app, turn, body,
  created_seq, created_at, state_seq`;

export function messageRowOf(row: SqlRow): MessageRow {
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    from_kind: String(row["from_kind"]) as MessageRow["from_kind"],
    from_ref: text(row["from_ref"]),
    call: text(row["call"]),
    reply_to: text(row["reply_to"]),
    refs: String(row["refs"]),
    reply: text(row["reply"]) as MessageRow["reply"],
    event: text(row["event"]),
    fail_reason: text(row["fail_reason"]) as MessageRow["fail_reason"],
    delivery: String(row["delivery"]) as MessageRow["delivery"],
    step_instance: text(row["step_instance"]),
    step_name: text(row["step_name"]),
    shell: Number(row["shell"]) === 1,
    origin_app: text(row["origin_app"]),
    turn: text(row["turn"]),
    body: String(row["body"]),
    created_seq: String(row["created_seq"]),
    created_at: String(row["created_at"]),
    state_seq: String(row["state_seq"]),
  };
}

export function loadMessage(
  lookup: Lookup,
  id: string,
): MessageRow | undefined {
  const row = lookup.sql.get(
    `select ${MESSAGE_COLUMNS} from messages where id = ?`,
    [id],
  );
  return row === undefined ? undefined : messageRowOf(row);
}

// 이름표(`<앱 id>|<slug>`)를 읽는다.
export function viaOfRow(
  origin: string | null,
): { app: string; slug: string } | null {
  if (origin === null) return null;
  const [app, ...slug] = origin.split("|");
  return { app: app!, slug: slug.join("|") };
}

// 받은 봉투의 보낸 쪽. 사람과 program은 근거가 없고, agent는 보낸 session, 앱은 앱 id와 보낼 때의 slug다.
export function receivedMessageOf(row: MessageRow): ReceivedMessage {
  const from = callFromOfRow(row.from_kind, row.from_ref);
  return {
    id: row.id,
    session: row.session,
    from,
    call: row.call,
    reply_to: row.reply_to,
    refs: JSON.parse(row.refs) as CallRef[],
    reply: row.reply,
    event: row.event,
    fail_reason: row.fail_reason,
    step:
      row.step_instance === null
        ? null
        : { instance: row.step_instance, step: row.step_name! },
    turn: row.turn,
    delivery: row.delivery,
    shell: row.shell,
    via: viaOfRow(row.origin_app),
    body: row.body,
    created_seq: row.created_seq,
    created_at: row.created_at,
  } as ReceivedMessage;
}

// Compact 요청. 요청 event의 순번이 요청의 이름이다. session마다 끝나지 않은 요청은 하나다.
// 요청의 진행은 session 행을 바꾸지 않으므로 사람의 입력 접수(session의 state_seq)에 닿지 않는다.
export function openCompactRequest(
  lookup: Lookup,
  session: string,
): { request_seq: string } | undefined {
  const row = lookup.sql.get(
    `select cast(request_seq as text) as request_seq from session_compact_requests
     where session = ? and state = 'requested'`,
    [session],
  );
  return row === undefined
    ? undefined
    : { request_seq: String(row["request_seq"]) };
}

// 도는 turn의 model 요청에 반영한 steer(queue에서 지금 올린 것 포함)를 그 turn이 가져간 것으로 적는다. 반영은 StartModelCall과 같은 tx다.
// 정상 종료 전에 미반영 steer가 없는지는 loop가 queue로 본다. 이미 turn이 정해진 message는 그대로 둔다.
export function takeSteering(
  tx: Tx,
  input: { messages: readonly string[]; call: string },
): Result<void> {
  const call = tx.sql.get("select turn from model_calls where id = ?", [
    input.call,
  ]);
  if (call === undefined || typeof call["turn"] !== "string") {
    return err({ code: "not_found", message: "model call not found" });
  }
  for (const message of input.messages) {
    const row = tx.sql.get("select delivery, turn from messages where id = ?", [
      message,
    ]);
    if (row === undefined || row["turn"] !== null) continue;
    tx.sql.run("update messages set turn = ? where id = ? and turn is null", [
      call["turn"],
      message,
    ]);
    // 다음 turn으로 접수했다가 [Send now]로 올린 메시지는 turn을 여는 입력이 아니므로 rewind 시점이 아니다.
    if (row["delivery"] === "next_turn") {
      tx.sql.run("delete from checkpoints where message = ?", [message]);
    }
  }
  return ok(undefined);
}
