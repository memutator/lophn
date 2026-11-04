import {
  type AgentId,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
  type Place,
  type PlaceSession,
  type ReceivedMessage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CallFrom, CallRef } from "../../../protocol/lophn-agent/calls.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
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
// reads.ts가 맡는다. 본문은 열에 없고 hash만 남는다. session의 agent와 place와 출처는 바뀌지
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
  place_kind: "project" | "app" | null;
  place_id: string | null;
  title: string | null;
  lifecycle: "open" | "archived";
  forked_from_session: string | null;
  forked_from_through_seq: string | null;
  model_selection: string | null;
  compaction_through_seq: string | null;
  compaction_summary_call: string | null;
  skip: boolean;
  created_seq: string;
  state_seq: string;
};
// 다른 단위가 이 이름으로 import한다.
export type SessionRow = AgentSessionRow;

export const SESSION_COLUMNS = `id, agent, project, app, place_kind,
  place_id, title, lifecycle, forked_from_session, forked_from_through_seq,
  model_selection, compaction_through_seq,
  compaction_summary_call, skip, created_seq, state_seq`;

export function sessionRowOf(row: SqlRow): AgentSessionRow {
  return {
    id: String(row["id"]),
    agent: String(row["agent"]) as AgentId,
    project: text(row["project"]),
    app: text(row["app"]),
    place_kind: text(row["place_kind"]) as AgentSessionRow["place_kind"],
    place_id: text(row["place_id"]),
    title: text(row["title"]),
    lifecycle: String(row["lifecycle"]) as AgentSessionRow["lifecycle"],
    forked_from_session: text(row["forked_from_session"]),
    forked_from_through_seq: text(row["forked_from_through_seq"]),
    model_selection: text(row["model_selection"]),
    compaction_through_seq: text(row["compaction_through_seq"]),
    compaction_summary_call: text(row["compaction_summary_call"]),
    skip: Number(row["skip"]) === 1,
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

export function placeOf(row: AgentSessionRow): Place | null {
  return row.place_kind === null || row.place_id === null
    ? null
    : ({ kind: row.place_kind, id: row.place_id } as Place);
}

// 같은 agent와 place의 session인지 가르는 조건.
export function sessionClause(
  agent: AgentId,
  place: Place | null,
): {
  sql: string;
  params: (string | null)[];
} {
  return {
    sql: "agent = ? and place_kind is ? and place_id is ?",
    params: [agent, place?.kind ?? null, place?.id ?? null],
  };
}

export function modelSelectionOf(
  row: AgentSessionRow,
): PlaceSession["model_selection"] {
  return row.model_selection === null
    ? null
    : (JSON.parse(row.model_selection) as PlaceSession["model_selection"]);
}

export function placeSessionOf(row: AgentSessionRow): PlaceSession {
  return {
    id: row.id,
    agent: row.agent,
    place: placeOf(row),
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
    skip: row.skip,
    state_seq: row.state_seq,
  } as PlaceSession;
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
  turn: string | null;
  body: string;
  created_seq: string;
  created_at: string;
  state_seq: string;
};

export const MESSAGE_COLUMNS = `id, session, from_kind, from_ref, call,
  reply_to, refs, reply, event, fail_reason, delivery, step_instance, step_name, turn, body,
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

// 받은 봉투의 보낸 쪽. 사람과 program은 근거가 없고, 나머지는 보낸 session이다.
export function receivedMessageOf(row: MessageRow): ReceivedMessage {
  const from =
    row.from_kind === "human"
      ? { kind: "human" as const }
      : row.from_kind === "program"
        ? { kind: "program" as const }
        : { kind: row.from_kind, session: row.from_ref! };
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

// 도는 turn이 있는지.
export function hasUnfinishedTurn(lookup: Lookup, session: string): boolean {
  return (
    lookup.sql.get(
      "select 1 as found from turns where session = ? and state = 'running' limit 1",
      [session],
    ) !== undefined
  );
}

// 도는 turn의 model 요청에 반영한 steer(입력함에서 지금 올린 것 포함)를 그 turn이 가져간 것으로 적는다. 반영은 StartModelCall과 같은 tx다.
// 정상 종료 전에 미반영 steer가 없는지는 loop가 입력함으로 본다. 이미 turn이 정해진 message는 그대로 둔다.
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
