import { canonicalize } from "../../base/mod.ts";
import {
  type Message,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  type MessageLink,
  type SessionRecord,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
  type SchemaStep,
  type SqlParams,
  type SqlRow,
} from "../../contracts/platform/mod.ts";

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
// 만든다. 본문은 열에 없고 hash만 남는다. 세션은 닫히면 다시 바뀌지 않고 확정
// 메시지의 본문·발언자·세션·mode·생성 순번은 덮어쓰지 않는다. 최초 반영은 한 번만
// 설정한다(R3). 삭제는 모두 막아 기록을 남긴다(R2).
export const conversationSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.conversation.tables",
    sql: `
create table sessions (
  id text primary key,
  assignment text not null references assignments (id) on delete restrict,
  role text not null check (role in ('lophn', 'app_engineer', 'context_engineer', 'operator')),
  work_place_kind text not null check (work_place_kind in ('global', 'project', 'app')),
  work_place_id text,
  work_place_revision integer not null check (work_place_revision >= 1),
  state text not null check (state in ('open', 'closed')),
  continued_from_session text references sessions (id) on delete restrict,
  continued_from_through_seq integer,
  closed_reason text check (closed_reason in ('user_closed', 'assignment_withdrawn')),
  closed_at text,
  created_seq integer not null check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((work_place_kind = 'global') = (work_place_id is null)),
  check ((continued_from_session is null) = (continued_from_through_seq is null)),
  check (continued_from_session is null or continued_from_session != id),
  check ((state = 'closed') = (closed_reason is not null)),
  check ((state = 'closed') = (closed_at is not null)),
  check (role != 'app_engineer' or work_place_kind = 'app'),
  check (role != 'operator' or work_place_kind != 'global')
) strict;
create index sessions_assignment_state on sessions (assignment, state);
create index sessions_continued_from
  on sessions (continued_from_session, continued_from_through_seq);
create trigger sessions_identity_immutable
before update of id, assignment, role, continued_from_session,
  continued_from_through_seq, created_seq on sessions
begin
  select raise(abort, 'session identity is immutable');
end;
create trigger sessions_closed_terminal
before update on sessions
when old.state = 'closed'
begin
  select raise(abort, 'a closed session is never reopened');
end;
create trigger sessions_no_delete
before delete on sessions
begin
  select raise(abort, 'sessions are kept');
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
  created_seq integer not null unique check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  check ((actor = 'user') = (mode is not null)),
  check (applied_at_call is null or run is not null),
  check (mode is not 'correction' or run is not null)
) strict;
create index messages_session_created on messages (session, created_seq);
create index messages_run_created on messages (run, created_seq);
create index messages_run_applied on messages (run, applied_at_call);
create trigger messages_content_immutable
before update of id, session, actor, body, mode, links, created_seq on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
create trigger messages_applied_once
before update of applied_at_call, run on messages
when old.applied_at_call is not null
begin
  select raise(abort, 'the first application of a message is fixed');
end;
create trigger messages_no_delete
before delete on messages
begin
  select raise(abort, 'messages are kept');
end;`,
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
  role: string;
  work_place_kind: string;
  work_place_id: string | null;
  work_place_revision: number;
  state: string;
  continued_from_session: string | null;
  continued_from_through_seq: string | null;
  closed_reason: string | null;
  closed_at: string | null;
  created_seq: string;
  state_seq: string;
};

export const SESSION_COLUMNS = `id, assignment, role, work_place_kind,
  work_place_id, work_place_revision, state, continued_from_session,
  continued_from_through_seq, closed_reason, closed_at, created_seq, state_seq`;

export function sessionRowOf(row: SqlRow): SessionRow {
  return {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    role: String(row["role"]),
    work_place_kind: String(row["work_place_kind"]),
    work_place_id: text(row["work_place_id"]),
    work_place_revision: Number(row["work_place_revision"]),
    state: String(row["state"]),
    continued_from_session: text(row["continued_from_session"]),
    continued_from_through_seq: text(row["continued_from_through_seq"]),
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
  return (row.work_place_kind === "global"
    ? { kind: "global", id: null }
    : { kind: row.work_place_kind, id: row.work_place_id }) as never;
}

export function sessionRecordOf(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    assignment: row.assignment,
    role: row.role as SessionRecord["role"],
    work_place: workPlaceOf(row),
    work_place_revision: row.work_place_revision,
    state: row.state as SessionRecord["state"],
    continued_from: row.continued_from_session === null ||
        row.continued_from_through_seq === null
      ? null
      : {
        session: row.continued_from_session,
        through_seq: row.continued_from_through_seq,
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
  created_seq: string;
  state_seq: string;
};

export const MESSAGE_COLUMNS = `id, session, actor, body, run, mode,
  applied_at_call, links, created_seq, state_seq`;

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
