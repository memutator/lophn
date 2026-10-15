import {
  type AgentRef,
  type AgentSession,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  type Place,
  type ReceivedMessage,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CallRef } from "../../../protocol/lophn-agent/calls.ts";
import type {
  SchemaStep,
  SqlParams,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";

// 본문 blob은 영구 보존이다. 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람,
// 그 session의 agent, machine)는 ReadMessageBody가 판정한다.
export const messageBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    field: MESSAGE_BODY_FIELD,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

// sessions·messages 표와 row 변환. 순수 함수와 읽기 조회만 있다. 상태 전이 규칙은 commands.ts, 읽기는
// reads.ts가 맡는다. 본문은 열에 없고 hash만 남는다. session의 agent(role과 place)와 출처는 바뀌지
// 않고, archive한 session은 다시 열리지 않는다. 두 표의 순번(created_seq, state_seq)은 ledger event
// 없이 표 안에서 이어 센다. 확정 메시지의 본문과 봉투는 덮어쓰지 않는다. session과 메시지는
// DeleteSession만 지운다.
// role과 place의 짝은 protocol의 `rolePlaceFits`와 같은 표다.
export const conversationSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.sessions.tables",
    sql: `
create table sessions (
  id text primary key,
  role text not null check (role in ('lophn', 'project_manager', 'app_engineer', 'operator')),
  project text,
  app text,
  operator text,
  place_kind text check (place_kind is null or place_kind in ('project', 'app')),
  place_id text,
  title text check (title is null or length(trim(title)) > 0),
  lifecycle text not null default 'open' check (lifecycle in ('open', 'archived')),
  forked_from_session text,
  forked_from_through_seq integer,
  opening_source_seq integer,
  opening_target text,
  model_selection text check (model_selection is null or json_valid(model_selection)),
  compaction_through_seq integer,
  compaction_summary_call text,
  created_seq integer not null check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((place_kind is null) = (place_id is null)),
  check (project is (case when place_kind = 'project' then place_id end)),
  check (app is (case when place_kind = 'app' then place_id end)),
  check ((role = 'operator') = (operator is not null)),
  check (
    (role = 'lophn' and place_kind is null) or
    (role = 'project_manager' and place_kind is 'project') or
    (role = 'app_engineer' and place_kind is 'app') or
    (role = 'operator' and place_kind is not null)
  ),
  check ((forked_from_session is null) = (forked_from_through_seq is null)),
  check (forked_from_session is null or forked_from_session != id),
  check ((opening_source_seq is null) = (opening_target is null)),
  check ((compaction_through_seq is null) = (compaction_summary_call is null))
) strict;
create index sessions_agent on sessions (role, place_kind, place_id, operator, lifecycle);
create trigger sessions_identity_immutable
before update of id, role, project, app, operator, place_kind, place_id,
  forked_from_session, forked_from_through_seq, opening_source_seq,
  opening_target, created_seq on sessions
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
  from_kind text not null check (from_kind in ('human', 'program', 'agent', 'coding_agent')),
  from_ref text,
  call text,
  reply_to text,
  refs text not null default '[]' check (json_valid(refs)),
  delivery text not null default 'next_turn' check (delivery in ('next_turn', 'steer')),
  turn text,
  body text not null check (length(body) = 64),
  created_seq integer not null unique check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((from_kind = 'human') = (from_ref is null)),
  check (delivery = 'next_turn' or from_kind = 'human')
) strict;
create index messages_session_created on messages (session, created_seq);
create index messages_turn on messages (turn);
create trigger messages_content_immutable
before update of id, session, from_kind, from_ref, call, reply_to, refs,
  delivery, body, created_seq on messages
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
];

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export type AgentSessionRow = {
  id: string;
  role: Role;
  project: string | null;
  app: string | null;
  operator: string | null;
  place_kind: "project" | "app" | null;
  place_id: string | null;
  title: string | null;
  lifecycle: "open" | "archived";
  forked_from_session: string | null;
  forked_from_through_seq: string | null;
  opening_source_seq: string | null;
  opening_target: string | null;
  model_selection: string | null;
  compaction_through_seq: string | null;
  compaction_summary_call: string | null;
  created_seq: string;
  state_seq: string;
};
// 다른 단위가 이 이름으로 import한다.
export type SessionRow = AgentSessionRow;

export const SESSION_COLUMNS = `id, role, project, app, operator, place_kind,
  place_id, title, lifecycle, forked_from_session, forked_from_through_seq,
  opening_source_seq, opening_target, model_selection, compaction_through_seq,
  compaction_summary_call, created_seq, state_seq`;

export function sessionRowOf(row: SqlRow): AgentSessionRow {
  return {
    id: String(row["id"]),
    role: String(row["role"]) as Role,
    project: text(row["project"]),
    app: text(row["app"]),
    operator: text(row["operator"]),
    place_kind: text(row["place_kind"]) as AgentSessionRow["place_kind"],
    place_id: text(row["place_id"]),
    title: text(row["title"]),
    lifecycle: String(row["lifecycle"]) as AgentSessionRow["lifecycle"],
    forked_from_session: text(row["forked_from_session"]),
    forked_from_through_seq: text(row["forked_from_through_seq"]),
    opening_source_seq: text(row["opening_source_seq"]),
    opening_target: text(row["opening_target"]),
    model_selection: text(row["model_selection"]),
    compaction_through_seq: text(row["compaction_through_seq"]),
    compaction_summary_call: text(row["compaction_summary_call"]),
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

export function placeOf(row: AgentSessionRow): Place | null {
  return row.place_kind === null || row.place_id === null
    ? null
    : { kind: row.place_kind, id: row.place_id } as Place;
}

export function agentRefOf(row: AgentSessionRow): AgentRef {
  switch (row.role) {
    case "lophn":
      return { role: "lophn" };
    case "project_manager":
      return { role: "project_manager", project: row.project! as never };
    case "app_engineer":
      return { role: "app_engineer", app: row.app! as never };
    case "operator":
      return { role: "operator", agent: row.operator! as never };
  }
}

// 같은 agent인지 가르는 조건. Project Manager와 App Engineer는 place가 정체성이고 Operator는 자기 ID다.
export function agentClause(
  agent: AgentRef,
): { sql: string; params: string[] } {
  switch (agent.role) {
    case "lophn":
      return { sql: "role = 'lophn'", params: [] };
    case "project_manager":
      return {
        sql: "role = 'project_manager' and project = ?",
        params: [agent.project],
      };
    case "app_engineer":
      return {
        sql: "role = 'app_engineer' and app = ?",
        params: [agent.app],
      };
    case "operator":
      return {
        sql: "role = 'operator' and operator = ?",
        params: [agent.agent],
      };
  }
}

export function modelSelectionOf(
  row: AgentSessionRow,
): AgentSession["model_selection"] {
  return row.model_selection === null
    ? null
    : JSON.parse(row.model_selection) as AgentSession["model_selection"];
}

export function agentSessionOf(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    agent: agentRefOf(row),
    place: placeOf(row),
    title: row.title,
    lifecycle: row.lifecycle,
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
    state_seq: row.state_seq,
  } as AgentSession;
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

export type MessageRow = {
  id: string;
  session: string;
  from_kind: "human" | "program" | "agent" | "coding_agent";
  from_ref: string | null;
  call: string | null;
  reply_to: string | null;
  refs: string;
  delivery: "next_turn" | "steer";
  turn: string | null;
  body: string;
  created_seq: string;
  state_seq: string;
};

export const MESSAGE_COLUMNS = `id, session, from_kind, from_ref, call,
  reply_to, refs, delivery, turn, body, created_seq, state_seq`;

export function messageRowOf(row: SqlRow): MessageRow {
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    from_kind: String(row["from_kind"]) as MessageRow["from_kind"],
    from_ref: text(row["from_ref"]),
    call: text(row["call"]),
    reply_to: text(row["reply_to"]),
    refs: String(row["refs"]),
    delivery: String(row["delivery"]) as MessageRow["delivery"],
    turn: text(row["turn"]),
    body: String(row["body"]),
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

// 받은 봉투의 보낸 쪽. 사람은 근거가 없고 program은 근거 event seq, 나머지는 보낸 session이다.
export function receivedMessageOf(row: MessageRow): ReceivedMessage {
  const from = row.from_kind === "human"
    ? { kind: "human" as const }
    : row.from_kind === "program"
    ? { kind: "program" as const, event_seq: row.from_ref! }
    : { kind: row.from_kind, session: row.from_ref! };
  return {
    id: row.id,
    session: row.session,
    from,
    call: row.call,
    reply_to: row.reply_to,
    refs: JSON.parse(row.refs) as CallRef[],
    turn: row.turn,
    delivery: row.delivery,
    body: row.body,
    created_seq: row.created_seq,
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

// 도는 turn이 있는지.
export function hasUnfinishedRun(lookup: Lookup, session: string): boolean {
  return lookup.sql.get(
    "select 1 as found from turns where session = ? and state = 'running' limit 1",
    [session],
  ) !== undefined;
}

export function eventExists(lookup: Lookup, seq: string): boolean {
  return lookup.sql.get("select 1 as found from events where seq = ?", [
    BigInt(seq),
  ]) !== undefined;
}

// turn의 정상 종료를 막는 미반영 steer. turn이 가져가지 않은 사람의 steer 메시지가 그 session에 남아 있는 것이다.
export function hasUnappliedSteering(lookup: Lookup, turn: string): boolean {
  return lookup.sql.get(
    `select 1 as found from turns t join messages m on m.session = t.session
     where t.id = ? and m.delivery = 'steer' and m.turn is null limit 1`,
    [turn],
  ) !== undefined;
}
