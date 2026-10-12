import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  finishRewindSummary,
  readRewindSummary,
  requestRewindSummary,
  takeRewindSummaryRequest,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { revertSchemaSteps } from "../../packages/core/lophn-agent/session/rewind/mod.ts";
import {
  createRewindSummaries,
  rewindSummaryTarget,
} from "./rewind-summary.ts";

// "Summarize from here"의 요약 요청 대기열(lophn-agent/revert R15). Compact와 같은 모양이다: 사람이 요청하면
// runtime이 요약 call을 하고, 끝낸 call을 돌려주면 사람이 그 call로 Rewind(summarize)를 확인한다. 대기열은
// core의 작업 메모리다(요약 call 자체는 model call 기록에 남는다).

const suffix = "01arz3ndektsv4rrffq69g5fav";
const SES = `ses_${suffix}`;
const MSG = `msg_${suffix}`;
const ASG = `asg_${suffix}`;
const MCL = `mcl_${suffix}`;
const ctx = {} as AuthenticatedContext;

function make(over: { ttlMs?: number; now?: () => number } = {}) {
  let counter = 0;
  const resolved: { session: string; checkpoint: string }[] = [];
  let target: Result<{ assignment: string; from_seq: string }> = ok({
    assignment: ASG,
    from_seq: "21",
  });
  const summaries = createRewindSummaries({
    resolve(input) {
      resolved.push(input);
      return target;
    },
    newId: () => `sum-${++counter}`,
    now: over.now ?? (() => 1_000),
    ...(over.ttlMs === undefined ? {} : { ttlMs: over.ttlMs }),
  });
  const handler = (route: { resource: string; method: string }) =>
    summaries.handlers.get(`${route.resource}/${route.method}`)!;
  const call = async (
    route: { resource: string; method: string },
    input: unknown,
  ) => await handler(route)(ctx, input);
  return {
    resolved,
    setTarget(next: Result<{ assignment: string; from_seq: string }>) {
      target = next;
    },
    request: (input: unknown = { session: SES, checkpoint: MSG }) =>
      call(requestRewindSummary, input),
    state: (request: string) => call(readRewindSummary, { request }),
    take: () => call(takeRewindSummaryRequest, {}),
    finish: (input: unknown) => call(finishRewindSummary, input),
  };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 요청하면 대기열에 서고 runtime이 한 번 가져가며, 끝난 요약 call이 사람에게 읽힌다", async () => {
  const w = make();
  const { request } = value(await w.request()) as { request: string };
  assertEquals(value(await w.state(request)), { state: "waiting" });
  // runtime은 요약할 session·담당·시작 seq를 가져간다. 가져간 요청은 다시 나오지 않는다.
  assertEquals(value(await w.take()), {
    request: { id: request, session: SES, assignment: ASG, from_seq: "21" },
  });
  assertEquals(value(await w.take()), { request: null });
  assertEquals(value(await w.state(request)), { state: "waiting" });
  assertEquals(
    value(
      await w.finish({
        id: request,
        result: { kind: "summarized", summary_call: MCL },
      }),
    ),
    { accepted: true },
  );
  assertEquals(value(await w.state(request)), {
    state: "summarized",
    summary_call: MCL,
  });
  // 같은 요청의 두 번째 답은 받지 않는다.
  assertEquals(
    value(
      await w.finish({
        id: request,
        result: { kind: "failed", reason: "model_failed" },
      }),
    ),
    { accepted: false },
  );
  assertEquals(value(await w.state(request)), {
    state: "summarized",
    summary_call: MCL,
  });
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 요약이 실패하면 이유를 알리고 session은 바뀌지 않는다", async () => {
  const w = make();
  const { request } = value(await w.request()) as { request: string };
  await w.take();
  value(
    await w.finish({
      id: request,
      result: { kind: "failed", reason: "nothing_to_summarize" },
    }),
  );
  assertEquals(value(await w.state(request)), {
    state: "failed",
    reason: "nothing_to_summarize",
  });
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 같은 checkpoint의 요약을 두 번 누르면 기다리는 요청 하나를 그대로 돌려준다", async () => {
  const w = make();
  const first = value(await w.request()) as { request: string };
  const again = value(await w.request()) as { request: string };
  assertEquals(again, first);
  const other = value(
    await w.request({ session: SES, checkpoint: `msg_${"2".repeat(26)}` }),
  ) as { request: string };
  assert(other.request !== first.request);
  // 끝난 뒤에는 새 요청이다.
  await w.take();
  value(
    await w.finish({
      id: first.request,
      result: { kind: "summarized", summary_call: MCL },
    }),
  );
  const fresh = value(await w.request()) as { request: string };
  assert(fresh.request !== first.request);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 요약할 수 없는 checkpoint는 대기열에 서지 않고 이유 그대로 거절한다", async () => {
  const w = make();
  for (const code of ["not_found", "forbidden", "conflict", "invalid_input"]) {
    w.setTarget(err({ code: code as "not_found", message: code }));
    const refused = await w.request();
    assert(!refused.ok);
    assertEquals(refused.error.code, code);
  }
  assertEquals(value(await w.take()), { request: null });
  // 입력이 모양에 맞지 않으면 확인하러 가지도 않는다.
  w.resolved.length = 0;
  const bad = await w.request({ session: SES });
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
  assertEquals(w.resolved, []);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 모르는 요청의 상태는 not_found이고 기한이 지난 요청은 가져가지도 읽지도 못한다", async () => {
  let clock = 1_000;
  const w = make({ ttlMs: 60_000, now: () => clock });
  const missing = await w.state("sum-404");
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
  const { request } = value(await w.request()) as { request: string };
  clock += 61_000;
  assertEquals(value(await w.take()), { request: null });
  const gone = await w.state(request);
  assert(!gone.ok);
  assertEquals(gone.error.code, "not_found");
  assertEquals(
    value(
      await w.finish({
        id: request,
        result: { kind: "summarized", summary_call: MCL },
      }),
    ),
    { accepted: false },
  );
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: runtime의 답이 모양에 맞지 않으면 거절하고 요청은 그대로 기다린다", async () => {
  const w = make();
  const { request } = value(await w.request()) as { request: string };
  const bad = await w.finish({ id: request, result: { kind: "summarized" } });
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
  assertEquals(value(await w.state(request)), { state: "waiting" });
});

// -------------------------------------------------------------- 요약할 곳을 정하는 읽기

function ledger() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table events (seq integer primary key autoincrement, type text);
    create table sessions (
      id text primary key, assignment text not null, state text not null
    );
    create table runs (
      id text primary key, session text, state text not null
    );
    create table messages (
      id text primary key, session text not null, actor text not null,
      mode text, copied_from text, created_seq integer not null
    );
    create table tool_calls (id text primary key);
  `);
  for (const step of revertSchemaSteps) db.exec(step.sql);
  const sql = {
    get: (query: string, params: readonly (string | number)[]) =>
      db.prepare(query).get(...(params as never[])) as
        | Record<string, unknown>
        | undefined,
    all: (query: string, params: readonly (string | number)[]) =>
      db.prepare(query).all(...(params as never[])) as Record<
        string,
        unknown
      >[],
  };
  const snapshot = <T>(read: (lookup: { sql: typeof sql }) => T): Result<T> =>
    ok(read({ sql }));
  const put = (query: string, ...params: (string | number | null)[]) =>
    db.prepare(query).run(...params);
  put("insert into sessions values (?, ?, 'open')", SES, ASG);
  put(
    "insert into messages values (?, ?, 'user', 'request', null, 21)",
    MSG,
    SES,
  );
  put(
    "insert into checkpoints (message, session) values (?, ?)",
    MSG,
    SES,
  );
  return { db, put, resolve: rewindSummaryTarget(snapshot as never) };
}

Deno.test("lophn-agent/revert#R12 lophn-agent/revert#R15 [agent-RW3e]: 요약은 checkpoint 메시지에서 시작하고 session의 담당과 그 메시지의 생성 seq를 runtime에 준다", () => {
  const w = ledger();
  assertEquals(
    w.resolve({ session: SES, checkpoint: MSG }),
    ok({
      assignment: ASG,
      from_seq: "21",
    }),
  );
});

Deno.test("lophn-agent/revert#R12 lophn-agent/revert#R15 [agent-RW3e]: 없는 session·다른 session의 메시지·checkpoint가 아닌 메시지(수정·복사)는 요약하지 않는다", () => {
  const w = ledger();
  const code = (input: { session: string; checkpoint: string }) => {
    const result = w.resolve(input);
    assert(!result.ok);
    return result.error.code;
  };
  assertEquals(
    code({ session: `ses_${"9".repeat(26)}`, checkpoint: MSG }),
    "not_found",
  );
  assertEquals(
    code({ session: SES, checkpoint: `msg_${"9".repeat(26)}` }),
    "not_found",
  );
  w.put(
    "insert into sessions values (?, ?, 'open')",
    `ses_${"2".repeat(26)}`,
    ASG,
  );
  assertEquals(
    code({ session: `ses_${"2".repeat(26)}`, checkpoint: MSG }),
    "not_found",
  );
  // checkpoint 행이 없는 사람 메시지(진행 중 수정, Fork 복사본)는 요약의 시작점이 아니다.
  const other = `msg_${"3".repeat(26)}`;
  w.put(
    "insert into messages values (?, ?, 'user', 'correction', null, 25)",
    other,
    SES,
  );
  assertEquals(code({ session: SES, checkpoint: other }), "invalid_input");
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 닫힌 session이나 끝나지 않은 work가 있는 session은 먼저 멈추라고 거절하고, 숨긴 구간 안 checkpoint는 고를 수 없다", () => {
  const w = ledger();
  w.put(
    "insert into runs values (?, ?, 'running')",
    `run_${"1".repeat(26)}`,
    SES,
  );
  const busy = w.resolve({ session: SES, checkpoint: MSG });
  assert(!busy.ok);
  assertEquals(busy.error.code, "conflict");
  w.put("update runs set state = 'finished'");
  assert(w.resolve({ session: SES, checkpoint: MSG }).ok);
  // 숨긴 구간(boundary_seq부터 result_seq까지) 안의 메시지는 고를 수 없다.
  w.put("insert into events (seq, type) values (30, 'RevertApplied')");
  w.put(
    `insert into reverts (id, session, kind, choice, checkpoint, boundary_seq, outcome, redo, preview_hash, result_seq)
     values (?, ?, 'rewind', 'messages_only', ?, 20, 'applied', 'available', ?, 30)`,
    `rvt_${"1".repeat(26)}`,
    SES,
    MSG,
    "a".repeat(64),
  );
  const hidden = w.resolve({ session: SES, checkpoint: MSG });
  assert(!hidden.ok);
  assertEquals(hidden.error.code, "invalid_input");
  w.put("update sessions set state = 'closed'");
  const closed = w.resolve({ session: SES, checkpoint: MSG });
  assert(!closed.ok);
  assertEquals(closed.error.code, "forbidden");
});
