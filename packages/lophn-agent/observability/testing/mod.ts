import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Result } from "../../../base/mod.ts";
import type { agentTraceRead } from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  RequestContext,
  SqlParams,
  SqlRow,
} from "../../../protocol/platform/mod.ts";
import { createTraceReads } from "../mod.ts";

// trace read 시험 fixture. 이 leaf가 읽는 열만 둔 ledger 모양이다(실제 표는 core 시험이 본다).
// 제품 코드와 mod.ts는 import하지 않는다. 실제 provider와 사람 데이터 root는 열지 않는다.

export const id = (prefix: string, n: number) =>
  `${prefix}_${"0".repeat(24)}${String(n).padStart(2, "0")}`;

export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function openLedger(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table assignments (id text primary key, role text, state text);
    create table sessions (id text primary key, assignment text, role text);
    create table events (
      seq integer primary key autoincrement, type text, subject text,
      actor text, run text, payload text, at text
    );
    create table runs (
      id text primary key, assignment text, session text, state text,
      basis text, started_at text, finished_at text, outcome_kind text,
      outcome_reason text, result text, elapsed_active_ms integer,
      source_kind text, source_message text, source_sender_run text,
      source_original_message text, accepted_seq integer
    );
    create table model_calls (
      id text primary key, run text, session text, attempt_order integer,
      state text, outcome text, duration_ms integer, first_output_ms integer,
      input text, context_basis text, output text, started_at text
    );
    create table tool_calls (
      id text primary key, run text, model_call text, response_order integer,
      attempt integer, state text, outcome text, decision text, extension text,
      duration_ms integer, input text, output text
    );
    create table messages (
      id text primary key, body text, run text, created_seq integer
    );
    create table blob_refs (
      owner_kind text, owner_key text, field text, hash text, size_bytes integer
    );
  `);
  return db;
}

export function ref(
  db: DatabaseSync,
  kind: string,
  key: string,
  field: string,
): string {
  const hash = hashOf(`${key}:${field}`);
  db.prepare("insert into blob_refs values (?, ?, ?, ?, 1)").run(
    kind,
    key,
    field,
    hash,
  );
  return hash;
}

export function addEvent(
  db: DatabaseSync,
  event: {
    type: string;
    subject: string | null;
    at: string;
    run?: string | null;
    payload?: Record<string, unknown>;
  },
): number {
  const done = db.prepare(
    "insert into events (type, subject, actor, run, payload, at) values (?, ?, 'machine', ?, ?, ?)",
  ).run(
    event.type,
    event.subject,
    event.run ?? null,
    JSON.stringify(event.payload ?? {}),
    event.at,
  );
  return Number(done.lastInsertRowid);
}

export type RunSeed = {
  id: string;
  assignment: string;
  session?: string | null;
  state?: "accepted" | "running" | "waiting_user" | "finished";
  startedAt?: string | null;
  finishedAt?: string | null;
  outcome?: [string, string] | null;
  activeMs?: number;
  source?: { kind: "message"; message: string } | {
    kind: "handoff";
    sender: string;
    original: string;
  };
  at?: string;
  // 영구 참조를 등록하지 않을 field.
  without?: readonly string[];
};

export function addRun(db: DatabaseSync, run: RunSeed): number {
  const state = run.state ?? "finished";
  const seq = addEvent(db, {
    type: "RunAccepted",
    subject: run.id,
    at: run.at ?? "2026-10-01T00:00:00.000Z",
  });
  const started = state !== "accepted";
  const source = run.source ?? { kind: "message", message: "" };
  const basis = started ? hashOf(`${run.id}:basis`) : null;
  const result = state === "finished" ? hashOf(`${run.id}:result`) : null;
  db.prepare(
    "insert into runs values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    run.id,
    run.assignment,
    run.session ?? null,
    state,
    basis,
    started ? run.startedAt ?? "2026-10-01T00:00:01.000Z" : null,
    state === "finished" ? run.finishedAt ?? "2026-10-01T00:00:09.000Z" : null,
    run.outcome?.[0] ?? null,
    run.outcome?.[1] ?? null,
    result,
    run.activeMs ?? 0,
    source.kind,
    source.kind === "message" && source.message !== "" ? source.message : null,
    source.kind === "handoff" ? source.sender : null,
    source.kind === "handoff" ? source.original : null,
    seq,
  );
  const without = run.without ?? [];
  if (basis !== null && !without.includes("basis")) {
    ref(db, "run", run.id, "basis");
  }
  if (result !== null && !without.includes("result")) {
    ref(db, "run", run.id, "result");
  }
  return seq;
}

export function addModel(
  db: DatabaseSync,
  call: {
    id: string;
    run: string | null;
    order: number;
    session?: string | null;
    state?: "started" | "finished";
    outcome?: Record<string, unknown> | null;
    durationMs?: number | null;
    firstOutputMs?: number | null;
    startedAt?: string;
    without?: readonly string[];
  },
): void {
  const state = call.state ?? "finished";
  const output = state === "finished" ? hashOf(`${call.id}:output`) : null;
  db.prepare(
    "insert into model_calls values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    call.id,
    call.run,
    call.session ?? null,
    call.order,
    state,
    state === "finished"
      ? JSON.stringify(call.outcome ?? { kind: "complete" })
      : null,
    call.durationMs ?? null,
    call.firstOutputMs ?? null,
    hashOf(`${call.id}:input`),
    hashOf(`${call.id}:context_basis`),
    output,
    call.startedAt ?? "2026-10-01T00:00:02.000Z",
  );
  const without = call.without ?? [];
  for (const field of ["input", "context_basis", "output"]) {
    if (field === "output" && output === null) continue;
    if (!without.includes(field)) ref(db, "model_call", call.id, field);
  }
}

export function addTool(
  db: DatabaseSync,
  call: {
    id: string;
    run: string;
    modelCall: string;
    order?: number;
    state?: "requested" | "started" | "finished";
    outcome?: string | null;
    decision?: "allow" | "ask" | "deny";
    external?: boolean;
    durationMs?: number | null;
  },
): void {
  const state = call.state ?? "finished";
  const output = state === "finished" && call.outcome !== "not_executed"
    ? hashOf(`${call.id}:output`)
    : null;
  db.prepare(
    "insert into tool_calls values (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    call.id,
    call.run,
    call.modelCall,
    call.order ?? 0,
    state,
    state === "finished"
      ? JSON.stringify({ kind: call.outcome ?? "success", code: "recorded" })
      : null,
    JSON.stringify({ decision: call.decision ?? "allow", reason: "policy" }),
    call.external === true ? JSON.stringify({ server_name: "notes" }) : null,
    call.durationMs ?? null,
    hashOf(`${call.id}:input`),
    output,
  );
  ref(db, "tool_call", call.id, "input");
  if (output !== null) ref(db, "tool_call", call.id, "output");
}

export function addMessage(
  db: DatabaseSync,
  message: { id: string; run: string | null; seq: number; stored?: boolean },
): void {
  const body = hashOf(`${message.id}:body`);
  db.prepare("insert into messages values (?, ?, ?, ?)").run(
    message.id,
    body,
    message.run,
    message.seq,
  );
  if (message.stored !== false) ref(db, "message", message.id, "body");
}

export function context(actor: string): RequestContext {
  return {
    actor,
    principal: actor,
    credential_ref: `ref-${actor}`,
    scope: { operations: [], targets: {} },
    conditions: {},
  } as unknown as RequestContext;
}

export function readTrace(
  db: DatabaseSync,
  actor: string,
  input: Input<typeof agentTraceRead>,
): Result<Output<typeof agentTraceRead>> {
  const snapshot = {
    sql: {
      get: (query: string, params: SqlParams) =>
        db.prepare(query).get(...(params as never[])) as SqlRow | undefined,
      all: (query: string, params: SqlParams) =>
        db.prepare(query).all(...(params as never[])) as SqlRow[],
    },
    as_of_seq: "1",
    port: () => {
      throw new Error("no ports in this fixture");
    },
  };
  return createTraceReads().read.handle(
    snapshot as never,
    context(actor),
    input,
  );
}
