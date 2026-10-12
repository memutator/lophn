import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  ReadDefinition,
  RequestContext,
  SqlParam,
  SqlRow,
  Tx,
} from "../../../contracts/platform/mod.ts";
import type {
  CommandRoute,
  ReadRoute,
} from "../../../contracts/platform/mod.ts";
import type { RevertDeps } from "../commands.ts";
import type { FileStat } from "../judge.ts";
import { revertSchemaSteps } from "../schema.ts";
import { createCheckpoint } from "../checkpoints.ts";

// 되돌리기 시험이 함께 쓰는 가짜 세계다. 실제 ledger 없이 node:sqlite 메모리 DB에 stub 표(events,
// sessions, runs, messages, tool_calls)와 revertSchemaSteps를 만들고, Tx를 얇게 흉내 낸다. 시각·id는
// 고정이고 네트워크·실제 provider는 없다. stub 표는 실제 표의 부분집합이다(열 이름은 같다).
// 제품 코드와 mod.ts는 이 파일을 import하지 않는다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const NOW = "2026-10-12T00:00:00.000Z";
export const SES = id("ses", 1);
export const OTHER_SES = id("ses", 2);
export const ASG = id("asg", 1);

export const MSG = (n: number) => id("msg", n);
export const RUN = (n: number) => id("run", n);
export const TCL = (n: number) => id("tcl", n);
export const RVT = (n: number) => id("rvt", n);
export const MCL = (n: number) => id("mcl", n);
export const APP = (n: number) => id("app", n);
export const REL = (n: number) => id("rel", n);
export const INV = (n: number) => id("inv", n);

export function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export const userCtx: RequestContext = ctxOf("user");
export const machineCtx: RequestContext = ctxOf("machine");
export function agentCtx(run = RUN(1)): RequestContext {
  return { ...ctxOf(`agent:${ASG}`), run };
}
export function ctxOf(actor: string): RequestContext {
  return {
    actor,
    principal: `${actor}-1`,
    credential_ref: `test:${actor}`,
    scope: { operations: [], targets: {} },
    conditions: {},
  };
}

export type StoredEvent = {
  seq: string;
  type: string;
  subject: string | null;
  actor: string;
  payload: Record<string, unknown>;
};

export type World = {
  db: DatabaseSync;
  tx: Tx;
  // command를 한 transaction으로 부른다. 실패(err)면 되돌려 아무것도 남지 않는다.
  call<R extends CommandRoute>(
    definition: CommandDefinition<R>,
    ctx: RequestContext,
    input: Input<R>,
    compare?: unknown,
  ): Result<Output<R>>;
  // 읽기 handler를 현재 snapshot으로 부른다.
  read<R extends ReadRoute>(
    definition: ReadDefinition<R>,
    ctx: RequestContext,
    input: Input<R>,
  ): Result<Output<R>>;
  lookup: { sql: { get: Tx["sql"]["get"]; all: Tx["sql"]["all"] } };
  query(sql: string, params?: readonly SqlParam[]): SqlRow[];
  events(type?: string): StoredEvent[];
  // session을 연다.
  addSession(session?: string, state?: "open" | "closed"): void;
  // 사람 메시지 하나(와 그 메시지가 시작한 run)를 넣고 checkpoint를 만든다. mode=correction이면
  // run 안의 수정 메시지라 checkpoint가 없다. 만든 메시지의 생성 seq를 돌려준다.
  addRequest(
    n: number,
    options?: { session?: string; mode?: "request" | "correction" },
  ): { message: string; run: string; seq: string };
  // messages 행만 하나 넣는다(checkpoint는 만들지 않는다).
  rawMessage(input: {
    id: string;
    session?: string;
    actor: string;
    mode: "request" | "correction" | null;
    copied_from?: string | null;
  }): void;
  // 사람이 아닌 메시지(agent·machine) 하나.
  addMessage(n: number, actor: string, session?: string): string;
  // run의 tool call 하나.
  addToolCall(
    n: number,
    run: string,
    options?: {
      effect?: "read" | "write" | "external";
      app_command?: Record<string, unknown> | null;
      outcome?: "success" | "failed" | "denied";
      result?: Record<string, unknown> | null;
    },
  ): string;
  // 새 event를 하나 더해 그 seq를 돌려준다(result_seq 같은 값을 만든다).
  nextSeq(type?: string): string;
  // reverts 행을 직접 심는다(숨김·redo 시험의 입력). 기본은 applied된 restore_all rewind다.
  seedRevert(input: {
    id: string;
    checkpoint: string;
    boundary_message: string;
    session?: string;
    choice?: "restore_all" | "messages_only" | "summarize";
    outcome?: "applied" | "partial" | "uncertain" | "blocked";
    redo?: "none" | "available" | "done" | "closed";
    summary_call?: string | null;
  }): { result_seq: string };
};

function failNotImplemented(): never {
  throw new Error("not implemented: agent-RW3a");
}

export function openWorld(): World {
  if (revertSchemaSteps.length === 0) failNotImplemented();
  const db = new DatabaseSync(":memory:");
  db.exec(`
    pragma foreign_keys = on;
    create table events (
      seq integer primary key autoincrement,
      type text not null, subject text, actor text not null, run text,
      payload text not null, at text not null
    );
    create table sessions (
      id text primary key,
      state text not null default 'open' check (state in ('open', 'closed'))
    );
    create table runs (
      id text primary key,
      session text references sessions (id),
      source_message text,
      state text not null default 'finished'
    );
    create table messages (
      id text primary key,
      session text not null references sessions (id),
      actor text not null,
      run text references runs (id),
      mode text check (mode in ('request', 'correction')),
      copied_from text,
      created_seq integer not null unique references events (seq)
    );
    create table tool_calls (
      id text primary key,
      run text not null references runs (id),
      effect text not null default 'write',
      app_command text check (app_command is null or json_valid(app_command)),
      state text not null default 'finished',
      state_seq integer not null,
      outcome text check (outcome is null or json_valid(outcome)),
      result text check (result is null or json_valid(result))
    );
  `);
  for (const step of revertSchemaSteps) db.exec(step.sql);

  let ids = 900;
  let actor = "user";
  let run: string | null = null;
  const sql = {
    run(query: string, params: readonly SqlParam[]) {
      const done = db.prepare(query).run(...(params as never[]));
      return { changes: done.changes, lastInsertRowid: done.lastInsertRowid };
    },
    get(query: string, params: readonly SqlParam[]) {
      return db.prepare(query).get(...(params as never[])) as
        | SqlRow
        | undefined;
    },
    all(query: string, params: readonly SqlParam[]) {
      return db.prepare(query).all(...(params as never[])) as SqlRow[];
    },
  };
  const tx: Tx = {
    sql,
    emit(event, subject, payload) {
      const parsed = (event.payload as { parse(value: unknown): unknown })
        .parse(payload);
      const done = sql.run(
        `insert into events (type, subject, actor, run, payload, at)
         values (?, ?, ?, ?, ?, ?)`,
        [event.type, subject, actor, run, JSON.stringify(parsed), NOW],
      );
      return String(done.lastInsertRowid);
    },
    now: () => NOW,
    newId: (prefix) => id(prefix, ids++ % 1024),
    port: () => {
      throw new Error("the revert fixture has no ports");
    },
    registerBlobRef: () => {
      throw new Error("the revert fixture has no blob refs");
    },
    advanceSubscriberCursor: () => {
      throw new Error("the revert fixture has no subscribers");
    },
    useApproval: () => {
      throw new Error("the revert fixture has no approvals");
    },
    call: () => {
      throw new Error("the revert fixture does not dispatch commands");
    },
  };
  const world: World = {
    db,
    tx,
    call(definition, ctx, input, compare = {}) {
      actor = ctx.actor;
      run = ctx.run ?? null;
      db.exec("begin");
      try {
        const result = definition.handle(
          tx,
          ctx,
          input,
          compare as never,
        );
        db.exec(result.ok ? "commit" : "rollback");
        return result;
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
    read(definition, ctx, input) {
      const head = sql.get(
        "select coalesce(max(seq), 0) as seq from events",
        [],
      )!;
      return definition.handle(
        {
          sql: { get: sql.get, all: sql.all },
          as_of_seq: String(head["seq"]),
          port: tx.port,
        },
        ctx,
        input,
      );
    },
    lookup: { sql: { get: sql.get, all: sql.all } },
    query: (query, params = []) => sql.all(query, params),
    events(type) {
      return sql.all(
        type === undefined
          ? "select seq, type, subject, actor, payload from events order by seq"
          : "select seq, type, subject, actor, payload from events where type = ? order by seq",
        type === undefined ? [] : [type],
      ).map((row) => ({
        seq: String(row["seq"]),
        type: String(row["type"]),
        subject: row["subject"] === null ? null : String(row["subject"]),
        actor: String(row["actor"]),
        payload: JSON.parse(String(row["payload"])),
      }));
    },
    addSession(session = SES, state = "open") {
      sql.run("insert into sessions (id, state) values (?, ?)", [
        session,
        state,
      ]);
    },
    nextSeq(type = "Fixture") {
      const done = sql.run(
        `insert into events (type, subject, actor, run, payload, at)
         values (?, null, 'machine', null, '{}', ?)`,
        [type, NOW],
      );
      return String(done.lastInsertRowid);
    },
    addRequest(n, options = {}) {
      const session = options.session ?? SES;
      const mode = options.mode ?? "request";
      const seq = world.nextSeq("MessageReceived");
      const message = MSG(n);
      let owner: string;
      if (mode === "request") {
        owner = RUN(n);
        sql.run(
          "insert into runs (id, session, source_message) values (?, ?, ?)",
          [owner, session, message],
        );
      } else {
        // 수정은 이미 있는 run에 붙는다: 가장 최근 run이다.
        owner = String(
          sql.get(
            "select id from runs where session = ? order by rowid desc limit 1",
            [session],
          )!["id"],
        );
      }
      sql.run(
        `insert into messages (id, session, actor, run, mode, copied_from, created_seq)
         values (?, ?, 'user', ?, ?, null, ?)`,
        [message, session, owner, mode, BigInt(seq)],
      );
      const created = createCheckpoint(tx, {
        id: message,
        session,
        actor: "user",
        mode,
        copied_from: null,
      });
      assert(
        created.ok,
        created.ok ? undefined : JSON.stringify(created.error),
      );
      return { message, run: owner, seq };
    },
    rawMessage(input) {
      const seq = world.nextSeq("MessageReceived");
      sql.run(
        `insert into messages (id, session, actor, run, mode, copied_from, created_seq)
         values (?, ?, ?, null, ?, ?, ?)`,
        [
          input.id,
          input.session ?? SES,
          input.actor,
          input.mode,
          input.copied_from ?? null,
          BigInt(seq),
        ],
      );
    },
    addMessage(n, messageActor, session = SES) {
      const seq = world.nextSeq("MessageRecorded");
      sql.run(
        `insert into messages (id, session, actor, run, mode, copied_from, created_seq)
         values (?, ?, ?, null, null, null, ?)`,
        [MSG(n), session, messageActor, BigInt(seq)],
      );
      return MSG(n);
    },
    addToolCall(n, owner, options = {}) {
      const seq = world.nextSeq("ToolCallFinished");
      sql.run(
        `insert into tool_calls (id, run, effect, app_command, state, state_seq, outcome, result)
         values (?, ?, ?, ?, 'finished', ?, ?, ?)`,
        [
          TCL(n),
          owner,
          options.effect ?? "write",
          options.app_command === undefined || options.app_command === null
            ? null
            : JSON.stringify(options.app_command),
          BigInt(seq),
          JSON.stringify({ kind: options.outcome ?? "success" }),
          options.result === undefined || options.result === null
            ? null
            : JSON.stringify(options.result),
        ],
      );
      return TCL(n);
    },
    seedRevert(input) {
      const resultSeq = world.nextSeq("RevertApplied");
      const boundary = sql.get(
        "select created_seq from messages where id = ?",
        [input.boundary_message],
      )!;
      const choice = input.choice ?? "restore_all";
      sql.run(
        `insert into reverts
           (id, session, kind, choice, checkpoint, tool_call, boundary_seq, summary_call,
            outcome, redo, preview_hash, result_seq)
         values (?, ?, 'rewind', ?, ?, null, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.session ?? SES,
          choice,
          input.checkpoint,
          boundary["created_seq"] as bigint | number,
          choice === "summarize" ? (input.summary_call ?? MCL(1)) : null,
          input.outcome ?? "applied",
          input.redo ?? "none",
          sha256(input.id),
          BigInt(resultSeq),
        ],
      );
      return { result_seq: resultSeq };
    },
  };
  return world;
}

// ---- 파일과 test용 deps ----

// 임시 project 폴더(절대 경로). 시험 하나가 하나씩 쓴다.
export function tempDir(label = "rewind"): string {
  return mkdtempSync(join(tmpdir(), `lophn-${label}-`));
}

export function writeProjectFile(
  root: string,
  path: string,
  content: string | Uint8Array,
): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export function readProjectFile(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

export type FakeEffects = {
  calls: { name: string; input: unknown }[];
  summaryOk: boolean;
  waiting: { questions: number; approvals: number };
  // true이면 기다리던 질문·approval 취소가 실패한다(Rewind 전체가 되돌려져야 한다).
  cancelFails: boolean;
};

// 대화 쪽 효과와 사실 메시지를 기록만 하는 deps다. observe는 실제 파일을 읽는 구현을 시험이
// 주입한다(prepare.ts의 observeFiles).
export function makeDeps(
  root: string,
  observe: RevertDeps["observe"],
  options: { revisions?: Record<string, string | null> } = {},
): { deps: RevertDeps; effects: FakeEffects; facts: string[] } {
  const effects: FakeEffects = {
    calls: [],
    summaryOk: true,
    waiting: { questions: 0, approvals: 0 },
    cancelFails: false,
  };
  const facts: string[] = [];
  const deps: RevertDeps = {
    observe,
    rootOf: () => root,
    appRevision: (app) => options.revisions?.[app] ?? null,
    effects: {
      summaryOk: (_lookup, input) => {
        effects.calls.push({ name: "summaryOk", input });
        return effects.summaryOk;
      },
      cancelWaiting: (_tx, input) => {
        effects.calls.push({ name: "cancelWaiting", input });
        if (effects.cancelFails) {
          return {
            ok: false,
            error: { code: "unavailable", message: "cancel failed" },
          };
        }
        return { ok: true, value: effects.waiting };
      },
      resetReadState: (_tx, input) => {
        effects.calls.push({ name: "resetReadState", input });
        return { ok: true, value: undefined };
      },
    },
    recordFact: (_tx, input) => {
      facts.push(input.text);
      return { ok: true, value: MSG(800 + facts.length) };
    },
  };
  return { deps, effects, facts };
}

export function must<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

export function failed(result: Result<unknown>, code: string): void {
  assert(!result.ok, "expected a rejected command");
  assertEquals(result.error.code, code);
}

export type { FileStat };
