import { canonicalize } from "../../../base/mod.ts";
import {
  type Message,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  type MessageLink,
  type SessionRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
  type SchemaStep,
  type SqlParams,
  type SqlRow,
} from "../../../protocol/server/mod.ts";

// 본문 blob은 영구 보존이다(R2). 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람,
// 그 assignment의 agent, machine)는 ReadMessageBody가 판정한다.
export const messageBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    field: MESSAGE_BODY_FIELD,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

// domain-model lophn-agent/conversation의 표와 row 변환. 순수 함수와 읽기
// 조회만 있다. 상태 전이 규칙은 commands.ts, 읽기는 reads.ts가 맡는다.

// sessions·messages 표(domain-model ledger 표). assignment·run·model_calls 뒤에
// 만든다. 본문은 열에 없고 hash만 남는다. 세션의 identity(assignment·자리·출처·첫
// context)는 바뀌지 않고, 닫힌 세션은 다시 열리거나 model·요약이 바뀌지 않는다.
// 확정 메시지의 본문·발언자·세션·mode·생성 순번은 덮어쓰지 않고 최초 반영은 한 번만
// 설정한다(R3). 세션과 메시지는 DeleteSession만 지운다: 진행 중이거나 기다리는 run이
// 있는 세션은 행 단계에서도 지우지 못한다(R20).
export const conversationSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.conversation.tables",
    sql: `
create table sessions (
  id text primary key,
  assignment text not null references assignments (id) on delete restrict,
  work_place_kind text not null check (work_place_kind in ('project', 'app')),
  work_place_id text not null,
  title text check (title is null or length(trim(title)) > 0),
  archived integer not null default 0 check (archived in (0, 1)),
  state text not null check (state in ('open', 'closed')),
  forked_from_session text,
  forked_from_through_seq integer,
  opening_source_seq integer,
  opening_target text,
  model_selection text check (model_selection is null or json_valid(model_selection)),
  compaction_through_seq integer,
  compaction_summary_call text,
  closed_reason text check (closed_reason in ('assignment_withdrawn')),
  closed_at text,
  created_seq integer not null check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((forked_from_session is null) = (forked_from_through_seq is null)),
  check (forked_from_session is null or forked_from_session != id),
  check ((opening_source_seq is null) = (opening_target is null)),
  check ((compaction_through_seq is null) = (compaction_summary_call is null)),
  check ((state = 'closed') = (closed_reason is not null)),
  check ((state = 'closed') = (closed_at is not null))
) strict;
create index sessions_place on sessions (assignment, work_place_kind, work_place_id, archived);
create index sessions_assignment_state on sessions (assignment, state);
create trigger sessions_identity_immutable
before update of id, assignment, work_place_kind, work_place_id,
  forked_from_session, forked_from_through_seq, opening_source_seq,
  opening_target, created_seq on sessions
begin
  select raise(abort, 'session identity is immutable');
end;
create trigger sessions_closed_terminal
before update of state, closed_reason, closed_at, model_selection,
  compaction_through_seq, compaction_summary_call on sessions
when old.state = 'closed'
begin
  select raise(abort, 'a closed session is never reopened or changed');
end;
create trigger sessions_delete_needs_finished_runs
before delete on sessions
when exists (select 1 from runs where session = old.id and state != 'finished')
begin
  select raise(abort, 'a session with an unfinished run is not deleted');
end;
create table messages (
  id text primary key,
  session text not null references sessions (id) on delete restrict,
  actor text not null check (length(actor) > 0),
  body text not null check (length(body) = 64),
  run text references runs (id) on delete restrict,
  mode text check (mode in ('request', 'correction')),
  applied_at_call text references model_calls (id) on delete restrict,
  links text not null default '[]' check (json_valid(links)),
  copied_from text,
  created_seq integer not null unique check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check (copied_from is not null or (actor = 'user') = (mode is not null)),
  check (copied_from is null or (mode is null and run is null and applied_at_call is null)),
  check (applied_at_call is null or run is not null),
  check (mode is not 'correction' or run is not null)
) strict;
create index messages_session_created on messages (session, created_seq);
create index messages_run_created on messages (run, created_seq);
create index messages_run_applied on messages (run, applied_at_call);
create trigger messages_content_immutable
before update of id, session, actor, body, mode, links, copied_from, created_seq on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
create trigger messages_applied_once
before update of applied_at_call, run on messages
when old.applied_at_call is not null
begin
  select raise(abort, 'the first application of a message is fixed');
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
];

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export type SessionRow = {
  id: string;
  assignment: string;
  work_place_kind: "project" | "app";
  work_place_id: string;
  title: string | null;
  archived: boolean;
  state: "open" | "closed";
  forked_from_session: string | null;
  forked_from_through_seq: string | null;
  opening_source_seq: string | null;
  opening_target: string | null;
  model_selection: string | null;
  compaction_through_seq: string | null;
  compaction_summary_call: string | null;
  closed_reason: string | null;
  closed_at: string | null;
  created_seq: string;
  state_seq: string;
};

export const SESSION_COLUMNS = `id, assignment, work_place_kind, work_place_id,
  title, archived, state, forked_from_session, forked_from_through_seq,
  opening_source_seq, opening_target, model_selection, compaction_through_seq,
  compaction_summary_call, closed_reason, closed_at, created_seq, state_seq`;

export function sessionRowOf(row: SqlRow): SessionRow {
  return {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    work_place_kind: String(row["work_place_kind"]) as SessionRow[
      "work_place_kind"
    ],
    work_place_id: String(row["work_place_id"]),
    title: text(row["title"]),
    archived: Number(row["archived"]) === 1,
    state: String(row["state"]) as SessionRow["state"],
    forked_from_session: text(row["forked_from_session"]),
    forked_from_through_seq: text(row["forked_from_through_seq"]),
    opening_source_seq: text(row["opening_source_seq"]),
    opening_target: text(row["opening_target"]),
    model_selection: text(row["model_selection"]),
    compaction_through_seq: text(row["compaction_through_seq"]),
    compaction_summary_call: text(row["compaction_summary_call"]),
    closed_reason: text(row["closed_reason"]),
    closed_at: text(row["closed_at"]),
    created_seq: String(row["created_seq"]),
    state_seq: String(row["state_seq"]),
  };
}

export function loadSession(
  lookup: Lookup,
  id: string,
): SessionRow | undefined {
  const row = lookup.sql.get(
    `select ${SESSION_COLUMNS} from sessions where id = ?`,
    [id],
  );
  return row === undefined ? undefined : sessionRowOf(row);
}

export function workPlaceOf(row: SessionRow): SessionRecord["work_place"] {
  return { kind: row.work_place_kind, id: row.work_place_id } as never;
}

export function modelSelectionOf(
  row: SessionRow,
): SessionRecord["model_selection"] {
  return row.model_selection === null
    ? null
    : JSON.parse(row.model_selection) as SessionRecord["model_selection"];
}

export function sessionRecordOf(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    assignment: row.assignment,
    work_place: workPlaceOf(row),
    title: row.title,
    archived: row.archived,
    state: row.state,
    forked_from: row.forked_from_session === null ||
        row.forked_from_through_seq === null
      ? null
      : {
        session: row.forked_from_session,
        through_seq: row.forked_from_through_seq,
      },
    opening_context: row.opening_source_seq === null ||
        row.opening_target === null
      ? null
      : { source_seq: row.opening_source_seq, target: row.opening_target },
    model_selection: modelSelectionOf(row),
    compaction: row.compaction_through_seq === null ||
        row.compaction_summary_call === null
      ? null
      : {
        through_seq: row.compaction_through_seq,
        summary_call: row.compaction_summary_call,
      },
    closed_reason: row.closed_reason as SessionRecord["closed_reason"],
    closed_at: row.closed_at,
    state_seq: row.state_seq,
  };
}

export type MessageRow = {
  id: string;
  session: string;
  actor: string;
  body: string;
  run: string | null;
  mode: string | null;
  applied_at_call: string | null;
  links: string;
  copied_from: string | null;
  created_seq: string;
  state_seq: string;
};

export const MESSAGE_COLUMNS = `id, session, actor, body, run, mode,
  applied_at_call, links, copied_from, created_seq, state_seq`;

export function messageRowOf(row: SqlRow): MessageRow {
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    actor: String(row["actor"]),
    body: String(row["body"]),
    run: text(row["run"]),
    mode: text(row["mode"]),
    applied_at_call: text(row["applied_at_call"]),
    links: String(row["links"]),
    copied_from: text(row["copied_from"]),
    created_seq: String(row["created_seq"]),
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

export function messageOf(row: MessageRow): Message {
  return {
    id: row.id,
    session: row.session,
    actor: row.actor as Message["actor"],
    body: row.body,
    run: row.run,
    mode: row.mode as Message["mode"],
    applied_at_call: row.applied_at_call,
    links: JSON.parse(row.links) as MessageLink[],
    copied_from: row.copied_from,
  };
}

export function snapshotOf(row: MessageRow) {
  return {
    message: messageOf(row),
    created_seq: row.created_seq,
    state_seq: row.state_seq,
  };
}

export type RunRef = {
  id: string;
  assignment: string;
  session: string | null;
  state: string;
  source_message: string | null;
};

export function loadRunRef(lookup: Lookup, id: string): RunRef | undefined {
  const row = lookup.sql.get(
    "select id, assignment, session, state, source_message from runs where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    session: text(row["session"]),
    state: String(row["state"]),
    source_message: text(row["source_message"]),
  };
}

// 세션의 가장 최근에 접수한 run. 다음 일의 선행 run이다(R6).
export function latestSessionRun(
  lookup: Lookup,
  session: string,
): string | null {
  const row = lookup.sql.get(
    "select id from runs where session = ? order by accepted_seq desc limit 1",
    [session],
  );
  return row === undefined ? null : String(row["id"]);
}

// 세션의 첫 사람 request가 이미 있는지. 첫 request만 제목을 정한다(R18). Fork 복사본은
// mode가 없어 세지 않는다.
export function hasPersonRequest(lookup: Lookup, session: string): boolean {
  return lookup.sql.get(
    `select 1 as found from messages
     where session = ? and actor = 'user' and mode = 'request' limit 1`,
    [session],
  ) !== undefined;
}

// Compact 요청(conversation#R10). 요청 event의 순번이 요청의 이름이다. session마다 끝나지 않은 요청은 하나다.
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

// 끝나지 않은 run(접수만 된 것, 진행 중, 사람을 기다리는 것)이 있는지.
export function hasUnfinishedRun(lookup: Lookup, session: string): boolean {
  return lookup.sql.get(
    "select 1 as found from runs where session = ? and state != 'finished' limit 1",
    [session],
  ) !== undefined;
}

export function eventExists(lookup: Lookup, seq: string): boolean {
  return lookup.sql.get("select 1 as found from events where seq = ?", [
    BigInt(seq),
  ]) !== undefined;
}

export type AssignmentRef = {
  id: string;
  role: string;
  state: string;
  revision: number;
  scope_kind: string;
  scope_id: string | null;
};

export function loadAssignmentRef(
  lookup: Lookup,
  id: string,
): AssignmentRef | undefined {
  const row = lookup.sql.get(
    `select id, role, state, revision, scope_kind, scope_id
     from assignments where id = ?`,
    [id],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    role: String(row["role"]),
    state: String(row["state"]),
    revision: Number(row["revision"]),
    scope_kind: String(row["scope_kind"]),
    scope_id: text(row["scope_id"]),
  };
}

// 정상 종료를 막는 미반영 steering(run-loop R14). 현재 일 수정(correction)만
// 센다. 다음 일(request)은 자기 run을 따로 갖고 정상 종료를 막지 않는다.
export function hasUnappliedSteering(lookup: Lookup, run: string): boolean {
  return lookup.sql.get(
    `select 1 as found from messages
     where run = ? and mode = 'correction' and applied_at_call is null
     limit 1`,
    [run],
  ) !== undefined;
}

// project·app이 지금 쓸 수 있는 대상인지. 만들어진 event가 있고 마지막 보관
// 상태가 해제된 것이다(assignments가 대상 보관을 읽는 방식과 같다).
export function targetIsActive(
  lookup: Lookup,
  kind: "project" | "app",
  id: string,
): boolean {
  const names = kind === "project"
    ? ["ProjectCreated", "ProjectArchived", "ProjectUnarchived"]
    : ["AppCreated", "AppArchived", "AppUnarchived"];
  const row = lookup.sql.get(
    `select type from events where subject = ? and type in (?, ?, ?)
     order by seq desc limit 1`,
    [id, names[0], names[1], names[2]],
  );
  if (row === undefined) return false;
  const type = String(row["type"]);
  return type === names[0] || type === names[2];
}

function exists(
  lookup: Lookup,
  query: string,
  params: SqlParams,
): boolean {
  return lookup.sql.get(query, params) !== undefined;
}

// 메시지 link는 실제 존재하는 대상만 가리킨다(R4). 계획이나 아직 없는 산출물은
// 링크가 될 수 없다.
export function linkExists(lookup: Lookup, link: MessageLink): boolean {
  switch (link.kind) {
    case "document":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'DocumentCreated'",
        [link.document],
      );
    case "version":
      return exists(
        lookup,
        `select 1 from events where subject = ?
         and (type = 'DocumentSaved' or type = 'DocumentCreated')
         and json_extract(payload, '$.version') = ?`,
        [link.document, link.version],
      );
    case "question":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'QuestionCreated'",
        [link.question],
      );
    case "approval_request":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'ApprovalRequestCreated'",
        [link.approval_request],
      );
    case "context":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'ContextCreated'",
        [link.context],
      );
    case "model_call":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'ModelCallStarted'",
        [link.call],
      );
    case "tool_call":
      return exists(
        lookup,
        "select 1 from events where subject = ? and type = 'ToolCallRequested'",
        [link.call],
      );
  }
}

export function sameLinks(
  stored: string,
  links: readonly MessageLink[],
): boolean {
  return canonicalize(JSON.parse(stored)) === canonicalize(links);
}
