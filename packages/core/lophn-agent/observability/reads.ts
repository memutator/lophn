import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentTraceRead,
  type TurnTrace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  ReadDefinition,
  RequestContext,
  SqlParam,
  SqlParams,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  assembleTrace,
  type EventFacts,
  mergeTraces,
  type MessageFacts,
  type ModelFacts,
  refKey,
  type TurnFacts,
  type ToolFacts,
} from "./model.ts";

// trace read는 pool read다. handler는 동기 Result를 돌려준다. 원본 표(turns·events·model_calls·
// tool_calls·messages·blob_refs)를 읽기만 하고 trace 자체는 어디에도 쓰지 않는다. 범위 밖 대상은
// 이유와 관계없이 없는 대상과 똑같이 not_found다(존재를 새지 않는다).

type Lookup = {
  sql: {
    get(query: string, params: SqlParams): SqlRow | undefined;
    all(query: string, params: SqlParams): SqlRow[];
  };
};

type Read = Input<typeof agentTraceRead>;

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "trace not found" });
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function count(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

// agent 자격은 자기 assignment의 것만 본다. 사람과 machine은 모두 본다.
function ownAssignment(ctx: RequestContext): string | null {
  const parts = parseActor(ctx.actor);
  return parts !== undefined && parts.kind === "agent" ? parts.id : null;
}

function allowed(ctx: RequestContext, assignment: string): boolean {
  const own = ownAssignment(ctx);
  return own === null || own === assignment;
}

function inPeriod(input: Read, at: string | null): boolean {
  if (input.from_at === undefined && input.through_at === undefined) {
    return true;
  }
  if (at === null) return false;
  return (input.from_at === undefined || at >= input.from_at) &&
    (input.through_at === undefined || at < input.through_at);
}

function roleMatches(
  lookup: Lookup,
  input: Read,
  assignment: string,
): boolean {
  if (input.role === undefined) return true;
  const row = lookup.sql.get("select role from assignments where id = ?", [
    assignment,
  ]);
  return row !== undefined && row["role"] === input.role;
}

function acceptedAt(lookup: Lookup, seq: SqlParam): string | null {
  const row = lookup.sql.get("select at from events where seq = ?", [
    seq,
  ]);
  return row === undefined ? null : String(row["at"]);
}

const TURN_COLUMNS = `id, assignment, session, state, basis, started_at,
  finished_at, outcome_kind, outcome_reason, result, elapsed_active_ms,
  source_kind, source_message, accepted_seq`;

type TurnRow = TurnFacts & {
  source_message: string | null;
  accepted_seq: SqlParam;
};

function loadTurn(lookup: Lookup, id: string): TurnRow | undefined {
  const row = lookup.sql.get(
    `select ${TURN_COLUMNS} from turns where id = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  const kind = text(row["outcome_kind"]);
  return {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    session: text(row["session"]),
    state: String(row["state"]) as TurnFacts["state"],
    basis: text(row["basis"]),
    started_at: text(row["started_at"]),
    finished_at: text(row["finished_at"]),
    outcome: kind === null ? null : {
      kind,
      reason: String(row["outcome_reason"]),
    } as TurnFacts["outcome"],
    result: text(row["result"]),
    elapsed_active_ms: Number(row["elapsed_active_ms"]),
    source_message: row["source_kind"] === "message"
      ? text(row["source_message"])
      : null,
    accepted_seq: row["accepted_seq"],
  };
}

function eventsOf(rows: readonly SqlRow[]): EventFacts[] {
  return rows.map((row) => ({
    seq: String(row["seq"]),
    type: String(row["type"]),
    at: String(row["at"]),
    waited_at: text(row["waited_at"]),
  }));
}

function loadTurnEvents(lookup: Lookup, turn: string): EventFacts[] {
  return eventsOf(lookup.sql.all(
    `select seq, type, at, json_extract(payload, '$.waited_at') as waited_at
       from events where seq in (
         select seq from events where subject = ?
         union select seq from events where turn = ?
         union select seq from events where subject in
           (select id from model_calls where turn = ?)
         union select seq from events where subject in
           (select id from tool_calls where turn = ?)
         union select seq from events where subject in
           (select id from messages where turn = ?)
       ) order by seq`,
    [turn, turn, turn, turn, turn],
  ));
}

function loadCallEvents(lookup: Lookup, call: string): EventFacts[] {
  return eventsOf(lookup.sql.all(
    `select seq, type, at, null as waited_at from events where seq in (
       select seq from events where subject = ?
       union select seq from events where subject in
         (select id from tool_calls where model_call = ?)
     ) order by seq`,
    [call, call],
  ));
}

const MODEL_COLUMNS = `id, attempt_order, state,
  json_extract(outcome, '$.kind') as outcome_kind, duration_ms,
  first_output_ms, input, context_basis, output`;

function modelsOf(rows: readonly SqlRow[]): ModelFacts[] {
  return rows.map((row) => ({
    id: String(row["id"]),
    attempt_order: Number(row["attempt_order"]),
    state: String(row["state"]) as ModelFacts["state"],
    outcome_kind: text(row["outcome_kind"]) as ModelFacts["outcome_kind"],
    duration_ms: count(row["duration_ms"]),
    first_output_ms: count(row["first_output_ms"]),
    input: String(row["input"]),
    context_basis: String(row["context_basis"]),
    output: text(row["output"]),
  }));
}

// 호출 순서(model 시도 번호, 응답 안 순서, 재시도 번호)로 읽는다. 샘플링은 없다.
function toolsOf(
  lookup: Lookup,
  where: string,
  param: string,
): ToolFacts[] {
  return lookup.sql.all(
    `select t.id, t.state, json_extract(t.outcome, '$.kind') as outcome_kind,
       json_extract(t.decision, '$.decision') as decision,
       t.extension is not null as external, t.duration_ms, t.input, t.output
     from tool_calls t left join model_calls m on m.id = t.model_call
     where ${where}
     order by coalesce(m.attempt_order, 0), t.response_order, t.attempt, t.id`,
    [param],
  ).map((row) => ({
    id: String(row["id"]),
    state: String(row["state"]) as ToolFacts["state"],
    outcome_kind: text(row["outcome_kind"]) as ToolFacts["outcome_kind"],
    decision: text(row["decision"]) as ToolFacts["decision"],
    external: Number(row["external"]) === 1,
    duration_ms: count(row["duration_ms"]),
    input: String(row["input"]),
    output: text(row["output"]),
  }));
}

function loadMessages(
  lookup: Lookup,
  turn: string,
  source: string | null,
): MessageFacts[] {
  return lookup.sql.all(
    `select id, body from messages where turn = ? or id = ?
     order by created_seq`,
    [turn, source],
  ).map((row) => ({ id: String(row["id"]), body: String(row["body"]) }));
}

// 보낸 쪽과 받은 쪽을 같은 관계 행에서 읽어 양방향 연결이 한 사실에서 나온다.
function loadLinks(lookup: Lookup, turn: string): TurnTrace["handoff_links"] {
  return lookup.sql.all(
    `select id as receiver_run, source_sender_run as sender_run,
       source_original_message as original_message
     from turns
     where source_kind = 'handoff' and (id = ? or source_sender_run = ?)
     order by accepted_seq`,
    [turn, turn],
  ).map((row) => ({
    sender_run: String(row["sender_run"]),
    receiver_run: String(row["receiver_run"]),
    original_message: String(row["original_message"]),
  }));
}

function loadRefs(
  lookup: Lookup,
  owners: {
    turn: string | null;
    models: readonly string[];
    tools: readonly string[];
    messages: readonly string[];
  },
): Set<string> {
  const rows = lookup.sql.all(
    `select owner_key, hash from blob_refs
       where owner_kind = 'turn' and owner_key = ?
     union all select owner_key, hash from blob_refs
       where owner_kind = 'model_call'
         and owner_key in (select value from json_each(?))
     union all select owner_key, hash from blob_refs
       where owner_kind = 'tool_call'
         and owner_key in (select value from json_each(?))
     union all select owner_key, hash from blob_refs
       where owner_kind = 'message'
         and owner_key in (select value from json_each(?))`,
    [
      owners.turn,
      JSON.stringify(owners.models),
      JSON.stringify(owners.tools),
      JSON.stringify(owners.messages),
    ],
  );
  return new Set(
    rows.map((row) => refKey(String(row["owner_key"]), String(row["hash"]))),
  );
}

// 시작 event는 있는데 기록 행이 없는 호출. 같은 transaction에 쓰이므로 정상에서는 없다.
function loadUnrecorded(lookup: Lookup, turn: string) {
  const subjects = (type: string, table: string) =>
    lookup.sql.all(
      `select subject from events
       where type = ? and json_extract(payload, '$.turn') = ?
         and subject not in (select id from ${table})
       order by seq`,
      [type, turn],
    ).map((row) => String(row["subject"]));
  return {
    models: subjects("ModelCallStarted", "model_calls"),
    tools: subjects("ToolCallRequested", "tool_calls"),
  };
}

function traceOfTurn(lookup: Lookup, turn: TurnRow): TurnTrace {
  const models = modelsOf(lookup.sql.all(
    `select ${MODEL_COLUMNS} from model_calls where turn = ?
     order by attempt_order`,
    [turn.id],
  ));
  const tools = toolsOf(lookup, "t.turn = ?", turn.id);
  const messages = loadMessages(lookup, turn.id, turn.source_message);
  return assembleTrace({
    turn,
    call: { turn: null, session: null, assignment: null },
    events: loadTurnEvents(lookup, turn.id),
    messages,
    models,
    tools,
    handoff_links: loadLinks(lookup, turn.id),
    refs: loadRefs(lookup, {
      turn: turn.id,
      models: models.map((m) => m.id),
      tools: tools.map((t) => t.id),
      messages: messages.map((m) => m.id),
    }),
    unrecorded: loadUnrecorded(lookup, turn.id),
  });
}

// turn 없이 기록된 호출의 trace로 조립한다. export가 쓴다(가시 판정은 route가 본다).

function turnTarget(
  lookup: Lookup,
  ctx: RequestContext,
  input: Read,
  id: string,
): Result<TurnTrace> {
  const turn = loadTurn(lookup, id);
  if (
    turn === undefined || !allowed(ctx, turn.assignment) ||
    !roleMatches(lookup, input, turn.assignment) ||
    !inPeriod(input, acceptedAt(lookup, turn.accepted_seq))
  ) return notFound();
  return ok(traceOfTurn(lookup, turn));
}

// turn 없이 기록된 호출은 호출 하나가 trace다. turn 안의 호출을 가리키면 그 호출의 실제 turn을 적는다.
function callTarget(
  lookup: Lookup,
  ctx: RequestContext,
  input: Read,
  id: string,
): Result<TurnTrace> {
  const row = lookup.sql.get(
    `select ${MODEL_COLUMNS}, turn as turn, session, started_at
       from model_calls where id = ?`,
    [id],
  );
  if (row === undefined) return notFound();
  const turn = text(row["turn"]);
  const owner = turn === null ? undefined : loadTurn(lookup, turn);
  const assignment = owner?.assignment ?? null;
  const visible = assignment === null
    ? ownAssignment(ctx) === null && input.role === undefined
    : allowed(ctx, assignment) && roleMatches(lookup, input, assignment);
  if (!visible || !inPeriod(input, text(row["started_at"]))) return notFound();
  const models = modelsOf([row]);
  const tools = toolsOf(lookup, "t.model_call = ?", id);
  return ok(assembleTrace({
    turn: null,
    call: { turn, session: text(row["session"]), assignment },
    events: loadCallEvents(lookup, id),
    messages: [],
    models,
    tools,
    handoff_links: [],
    refs: loadRefs(lookup, {
      turn: null,
      models: [id],
      tools: tools.map((t) => t.id),
      messages: [],
    }),
    unrecorded: { models: [], tools: [] },
  }));
}

function cursorAfter(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_seq?: unknown };
    if (typeof parsed.after_seq !== "number") throw new TypeError("cursor");
    return ok(parsed.after_seq);
  } catch {
    return err({ code: "invalid_input", message: "invalid trace cursor" });
  }
}

// session의 trace는 요청한 쪽의 turn들을 접수 순서로 한 쪽씩 묶는다. 한 쪽은 limit(기본 50)개 turn이다.
function sessionTarget(
  lookup: Lookup,
  ctx: RequestContext,
  input: Read,
  id: string,
): Result<{ trace: TurnTrace; next: string | null }> {
  const session = lookup.sql.get(
    `select s.assignment as assignment, a.role as role
       from sessions s join assignments a on a.id = s.assignment
       where s.id = ?`,
    [id],
  );
  if (
    session === undefined || !allowed(ctx, String(session["assignment"])) ||
    (input.role !== undefined && session["role"] !== input.role)
  ) return notFound();
  const after = cursorAfter(input.cursor);
  if (!after.ok) return after;
  const limit = input.limit ?? PAGE;
  const rows = lookup.sql.all(
    `select r.id, r.accepted_seq from turns r
       join events e on e.seq = r.accepted_seq
       where r.session = ? and r.accepted_seq > ?
         and (? is null or e.at >= ?) and (? is null or e.at < ?)
       order by r.accepted_seq limit ?`,
    [
      id,
      after.value,
      input.from_at ?? null,
      input.from_at ?? null,
      input.through_at ?? null,
      input.through_at ?? null,
      limit + 1,
    ],
  );
  const page = rows.slice(0, limit);
  const traces = page.map((row) =>
    traceOfTurn(lookup, loadTurn(lookup, String(row["id"]))!)
  );
  const last = page[page.length - 1];
  return ok({
    trace: mergeTraces(id, String(session["assignment"]), traces),
    next: rows.length > limit && last !== undefined
      ? btoa(JSON.stringify({ after_seq: Number(last["accepted_seq"]) }))
      : null,
  });
}

export function createTraceReads(): {
  read: ReadDefinition<typeof agentTraceRead>;
} {
  return {
    read: {
      route: agentTraceRead,
      handle(snapshot, ctx, input) {
        const target = input.target;
        const found = target.kind === "session"
          ? sessionTarget(snapshot, ctx, input, target.session)
          : (() => {
            const traced = target.kind === "turn"
              ? turnTarget(snapshot, ctx, input, target.turn)
              : callTarget(snapshot, ctx, input, target.model_call);
            return traced.ok ? ok({ trace: traced.value, next: null }) : traced;
          })();
        if (!found.ok) return found;
        return ok({
          trace: found.value.trace,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: found.value.next,
        });
      },
    },
  };
}
