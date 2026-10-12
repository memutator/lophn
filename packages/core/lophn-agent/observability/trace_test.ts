import { assert, assertEquals } from "@std/assert";
import type { DatabaseSync } from "node:sqlite";
import {
  agentTraceReadOutputSchema,
  type RunTrace,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  addEvent,
  addMessage,
  addModel,
  addRun,
  addTool,
  hashOf,
  id,
  openLedger,
  readTrace,
} from "./testing/mod.ts";

// 조립만 본다. 실제 ledger 표와 core 등록은 apps/core/agent-trace_test.ts가 본다.

const LOPHN = id("asg", 1);
const ENGINEER = id("asg", 2);
const SES = id("ses", 1);
const T0 = "2026-10-01T00:00:00.000Z";

const TRACE_KEYS = [
  "activity",
  "assignment",
  "basis",
  "events",
  "finished_at",
  "handoff_links",
  "messages",
  "missing",
  "model_calls",
  "reason",
  "run",
  "session",
  "started_at",
  "state",
  "times",
  "tool_calls",
];

function ledger(): DatabaseSync {
  const db = openLedger();
  db.prepare("insert into assignments values (?, 'lophn', 'enabled')").run(
    LOPHN,
  );
  db.prepare(
    "insert into assignments values (?, 'context_engineer', 'enabled')",
  ).run(ENGINEER);
  db.prepare("insert into sessions values (?, ?, 'lophn')").run(SES, LOPHN);
  return db;
}

function read(db: DatabaseSync, actor: string, target: unknown): RunTrace {
  const read = readTrace(db, actor, { target } as never);
  assert(read.ok, JSON.stringify(read));
  assert(agentTraceReadOutputSchema.safeParse(read.value).success);
  return read.value.trace;
}

const runTarget = (run: string) => ({ kind: "run", run });

// 시작 → 호출 → 종료 event가 있는 run 하나.
function simpleRun(db: DatabaseSync, n: number, assignment = LOPHN) {
  const run = id("run", n);
  addRun(db, {
    id: run,
    assignment,
    session: SES,
    outcome: ["completed", "answer_completed"],
    activeMs: 4000,
    source: { kind: "message", message: id("msg", n) },
  });
  addMessage(db, { id: id("msg", n), run, seq: n * 10 });
  const events = [
    addEvent(db, { type: "RunStarted", subject: run, at: T0 }),
    addEvent(db, {
      type: "ModelCallStarted",
      subject: id("mcl", n),
      at: T0,
      payload: { run },
    }),
    addEvent(db, {
      type: "ToolCallRequested",
      subject: id("tcl", n),
      at: T0,
      payload: { run },
    }),
    addEvent(db, { type: "RunFinished", subject: run, at: T0 }),
  ];
  addModel(db, { id: id("mcl", n), run, order: 1, durationMs: 2000 });
  addTool(db, { id: id("tcl", n), run, modelCall: id("mcl", n) });
  return { run, events };
}

Deno.test("lophn-agent/observability#R1: a trace is assembled in seq order from run, event, call and message references and nothing is stored", () => {
  const db = ledger();
  const mine = simpleRun(db, 1);
  const other = simpleRun(db, 2);
  addEvent(db, { type: "RunStarted", subject: other.run, at: T0 });
  const tables = () =>
    JSON.stringify(db.prepare("select name from sqlite_master").all());
  const before = tables();
  const trace = read(db, "user", runTarget(mine.run));
  assertEquals(Object.keys(trace).sort(), TRACE_KEYS);
  assertEquals(trace.run, mine.run);
  assertEquals(trace.events.length, 5);
  assertEquals(trace.events.slice(1), mine.events.map(String));
  assertEquals(trace.messages, [id("msg", 1)]);
  assertEquals(trace.model_calls, [id("mcl", 1)]);
  assertEquals(trace.tool_calls, [id("tcl", 1)]);
  assertEquals(trace.reason, { kind: "completed", reason: "answer_completed" });
  assertEquals(trace.missing, []);
  // 읽어도 표는 늘지 않고 trace 원본 저장소가 없다.
  assertEquals(tables(), before);
  assert(!before.includes("trace"));
});

Deno.test("lophn-agent/observability#R1: a session trace folds its runs page by page", () => {
  const db = ledger();
  simpleRun(db, 1);
  simpleRun(db, 2);
  const target = { kind: "session", session: SES };
  const page = readTrace(db, "user", { target, limit: 1 } as never);
  assert(page.ok && page.value.next_cursor !== null);
  assertEquals(page.value.trace.run, null);
  assertEquals(page.value.trace.session, SES);
  assertEquals(page.value.trace.model_calls, [id("mcl", 1)]);
  const rest = readTrace(db, "user", {
    target,
    limit: 1,
    cursor: page.value.next_cursor,
  } as never);
  assert(rest.ok && rest.value.next_cursor === null);
  assertEquals(rest.value.trace.model_calls, [id("mcl", 2)]);
  assertEquals(rest.value.trace.events.length, 5);
});

Deno.test("lophn-agent/observability#R2: start conditions are a fixed reference and no instruction body is copied", () => {
  const db = ledger();
  const { run } = simpleRun(db, 1);
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.basis, hashOf(`${run}:basis`));
  assertEquals(trace.assignment, LOPHN);
  assertEquals(trace.started_at, "2026-10-01T00:00:01.000Z");
  // 역할 정의와 대상을 바꿔도 이전 시작 조건은 같은 참조다.
  db.exec("update assignments set role = 'operator', state = 'paused'");
  assertEquals(read(db, "user", runTarget(run)).basis, trace.basis);
  const text = JSON.stringify(trace);
  for (const word of ["prompt", "instruction", "preset", "persona"]) {
    assert(!text.includes(word), word);
  }
});

Deno.test("lophn-agent/observability#R3: a handoff receiver is its own trace linked both ways without moving the actor or the calls", () => {
  const db = ledger();
  const sender = simpleRun(db, 1);
  const receiver = id("run", 2);
  addRun(db, {
    id: receiver,
    assignment: ENGINEER,
    session: id("ses", 2),
    outcome: ["completed", "answer_completed"],
    source: { kind: "handoff", sender: sender.run, original: id("msg", 1) },
  });
  addModel(db, { id: id("mcl", 2), run: receiver, order: 1 });
  const link = {
    sender_run: sender.run,
    receiver_run: receiver,
    original_message: id("msg", 1),
  };
  const fromSender = read(db, "user", runTarget(sender.run));
  const fromReceiver = read(db, "user", runTarget(receiver));
  assertEquals(fromSender.handoff_links, [link]);
  assertEquals(fromReceiver.handoff_links, [link]);
  assertEquals(fromReceiver.assignment, ENGINEER);
  assertEquals(fromReceiver.model_calls, [id("mcl", 2)]);
  assertEquals(fromSender.model_calls, [id("mcl", 1)]);
});

Deno.test("lophn-agent/observability#R4: a call outside any run is its own trace and creates no run or session", () => {
  const db = ledger();
  addModel(db, { id: id("mcl", 1), run: null, order: 1, durationMs: 800 });
  addModel(db, {
    id: id("mcl", 2),
    run: null,
    session: SES,
    order: 1,
    durationMs: 500,
  });
  const counts = () =>
    JSON.stringify([
      db.prepare("select count(*) as n from runs").get(),
      db.prepare("select count(*) as n from sessions").get(),
    ]);
  const before = counts();
  const background = read(db, "machine", {
    kind: "model_call",
    model_call: id("mcl", 1),
  });
  assertEquals(background.run, null);
  assertEquals(background.session, null);
  assertEquals(background.model_calls, [id("mcl", 1)]);
  assertEquals(background.basis, null);
  assertEquals(background.times.model_ms, 800);
  const titled = read(db, "user", {
    kind: "model_call",
    model_call: id("mcl", 2),
  });
  assertEquals(titled.run, null);
  assertEquals(titled.session, SES);
  assertEquals(counts(), before);
  // run 없는 호출은 사람과 machine의 것이다. agent는 없는 호출과 같은 답이다.
  const hidden = readTrace(db, `agent:${LOPHN}`, {
    target: { kind: "model_call", model_call: id("mcl", 1) },
  } as never);
  const absent = readTrace(db, `agent:${LOPHN}`, {
    target: { kind: "model_call", model_call: id("mcl", 9) },
  } as never);
  assertEquals(hidden, absent);
  // run 안의 호출은 그 호출의 실제 run을 가리킨다.
  simpleRun(db, 3);
  const inside = read(db, "user", {
    kind: "model_call",
    model_call: id("mcl", 3),
  });
  assertEquals(inside.run, id("run", 3));
  assertEquals(inside.tool_calls, [id("tcl", 3)]);
});

Deno.test("lophn-agent/observability#R5: every model attempt and tool verdict is listed unsampled with retry, failure, cancel, refusal and unknown kept apart", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, {
    id: run,
    assignment: LOPHN,
    outcome: ["failed", "model_error"],
  });
  // 넣는 순서와 시도 번호 순서가 달라도 시도 순으로 나온다.
  const kinds = ["complete", "failed", "failed", "cancelled", "uncertain"];
  for (const order of [3, 1, 2, 5, 4]) {
    addModel(db, {
      id: id("mcl", order),
      run,
      order,
      outcome: { kind: kinds[order - 1] },
    });
  }
  addTool(db, {
    id: id("tcl", 1),
    run,
    modelCall: id("mcl", 3),
    outcome: "not_executed",
    decision: "deny",
  });
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.model_calls, [1, 2, 3, 4, 5].map((n) => id("mcl", n)));
  assertEquals(trace.activity.model.attempts, 5);
  assertEquals(trace.activity.model.failed, [id("mcl", 2), id("mcl", 3)]);
  assertEquals(trace.activity.model.cancelled, [id("mcl", 4)]);
  assertEquals(trace.activity.model.uncertain, [id("mcl", 5)]);
  assertEquals(trace.tool_calls, [id("tcl", 1)]);
  assertEquals(trace.activity.tools.denied, [id("tcl", 1)]);
  assertEquals(trace.activity.tools.succeeded, 0);
  assertEquals(trace.missing, []);
});

Deno.test("lophn-agent/observability#R5: a missing attempt, an unrecorded call and an unfinished call are marked, not skipped", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, { id: run, assignment: LOPHN, outcome: ["failed", "tool_error"] });
  addModel(db, { id: id("mcl", 1), run, order: 1 });
  addModel(db, { id: id("mcl", 3), run, order: 3, state: "started" });
  addEvent(db, {
    type: "ModelCallStarted",
    subject: id("mcl", 7),
    at: T0,
    payload: { run },
  });
  addEvent(db, {
    type: "ToolCallRequested",
    subject: id("tcl", 8),
    at: T0,
    payload: { run },
  });
  const trace = read(db, "user", runTarget(run));
  const missing = trace.missing.map((entry) =>
    `${entry.kind}:${entry.reference}:${entry.reason}`
  );
  assertEquals(
    missing.sort(),
    [
      `record:${id("mcl", 3)}:result_not_recorded`,
      `record:${id("mcl", 7)}:model_call_absent`,
      `record:${id("tcl", 8)}:tool_call_absent`,
      `record:${run}#attempt-2:attempt_record_absent`,
    ].sort(),
  );
  assertEquals(trace.activity.model.unfinished, [id("mcl", 3)]);
});

Deno.test("lophn-agent/observability#R6: waiting, model and tool time are separate monotonic values and a moved-back clock never goes negative", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, {
    id: run,
    assignment: LOPHN,
    activeMs: 2700,
    outcome: ["completed", "answer_completed"],
  });
  addEvent(db, {
    type: "RunWaited",
    subject: run,
    at: "2026-10-01T00:00:02.000Z",
    payload: { waited_at: "2026-10-01T00:00:02.000Z" },
  });
  addEvent(db, {
    type: "RunResumed",
    subject: run,
    at: "2026-10-01T00:00:12.000Z",
  });
  addModel(db, {
    id: id("mcl", 1),
    run,
    order: 1,
    durationMs: 2000,
    firstOutputMs: 350,
  });
  addTool(db, {
    id: id("tcl", 1),
    run,
    modelCall: id("mcl", 1),
    durationMs: 700,
  });
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.times, {
    wall_ms: 12700,
    active_ms: 2700,
    waiting_ms: 10000,
    model_ms: 2000,
    first_output_ms: 350,
    tool_ms: 700,
  });
  assert(/^\d{4}-\d\d-\d\dT[\d:]+\.\d{3}Z$/.test(trace.started_at ?? ""));
  assert(/^\d{4}-\d\d-\d\dT[\d:]+\.\d{3}Z$/.test(trace.finished_at ?? ""));

  // 시스템 시계가 뒤로 갔다: 끝 시각이 시작보다 앞서고 재개 event가 기다림 시작보다 앞선다.
  const back = id("run", 2);
  addRun(db, {
    id: back,
    assignment: LOPHN,
    activeMs: 4000,
    startedAt: "2026-10-01T00:10:00.000Z",
    finishedAt: "2026-10-01T00:05:00.000Z",
    outcome: ["completed", "answer_completed"],
  });
  addEvent(db, {
    type: "RunWaited",
    subject: back,
    at: "2026-10-01T00:10:30.000Z",
    payload: { waited_at: "2026-10-01T00:10:30.000Z" },
  });
  addEvent(db, {
    type: "RunResumed",
    subject: back,
    at: "2026-10-01T00:06:00.000Z",
  });
  const moved = read(db, "user", runTarget(back));
  assertEquals(moved.times.active_ms, 4000);
  assertEquals(moved.times.waiting_ms, 0);
  assertEquals(moved.times.wall_ms, 4000);
  for (const value of Object.values(moved.times)) assert((value ?? 0) >= 0);
});

Deno.test("lophn-agent/observability#R7: end kinds stay distinct and a run cut off without an end event is unconfirmed, never success", () => {
  const db = ledger();
  const ends: [string, string][] = [
    ["completed", "answer_completed"],
    ["failed", "model_error"],
    ["failed", "tool_error"],
    ["stopped", "user_stopped"],
  ];
  ends.forEach(([kind, reason], index) => {
    addRun(db, {
      id: id("run", index + 1),
      assignment: LOPHN,
      outcome: [kind, reason],
    });
  });
  const reasons = ends.map((_, index) =>
    read(db, "user", runTarget(id("run", index + 1))).reason
  );
  assertEquals(
    JSON.stringify(reasons),
    JSON.stringify(ends.map(([kind, reason]) => ({ kind, reason }))),
  );
  // 모델이 끝났다고 했어도 변경이 실패한 사실은 남는다.
  addTool(db, {
    id: id("tcl", 1),
    run: id("run", 3),
    modelCall: id("mcl", 1),
    outcome: "failure",
  });
  assertEquals(
    read(db, "user", runTarget(id("run", 3))).activity.tools.failed,
    [id("tcl", 1)],
  );
  // daemon이 중간에 죽은 run: 종료 event도 결과도 없다.
  const cut = id("run", 9);
  addRun(db, { id: cut, assignment: LOPHN, state: "running" });
  addModel(db, { id: id("mcl", 9), run: cut, order: 1, state: "started" });
  const trace = read(db, "user", runTarget(cut));
  assertEquals(trace.reason, null);
  assertEquals(trace.state, "running");
  assertEquals(trace.finished_at, null);
  assert(
    trace.missing.some((entry) =>
      entry.reference === cut && entry.reason === "end_not_confirmed"
    ),
  );
  assertEquals(
    read(db, "user", runTarget(cut)).activity.model.unfinished,
    [id("mcl", 9)],
  );
});

Deno.test("lophn-agent/observability#R8: model input, output and context basis are referenced from their owners and an absent original is reported", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, {
    id: run,
    assignment: LOPHN,
    outcome: ["completed", "answer_completed"],
  });
  addModel(db, { id: id("mcl", 1), run, order: 1 });
  addModel(db, {
    id: id("mcl", 2),
    run,
    order: 2,
    without: ["context_basis", "output"],
  });
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.model_calls, [id("mcl", 1), id("mcl", 2)]);
  assertEquals(trace.missing, [
    {
      kind: "body",
      reference: `${id("mcl", 2)}:context_basis`,
      reason: "reference_not_registered",
    },
    {
      kind: "body",
      reference: `${id("mcl", 2)}:output`,
      reason: "reference_not_registered",
    },
  ]);
  // 본문과 hash 사본은 trace에 없다.
  assert(!JSON.stringify(trace).includes(hashOf(`${id("mcl", 1)}:input`)));
});

Deno.test("lophn-agent/observability#R9: no free-form error text, secret or copied body reaches the trace", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, {
    id: run,
    assignment: LOPHN,
    outcome: ["failed", "model_error"],
  });
  addModel(db, {
    id: id("mcl", 1),
    run,
    order: 1,
    outcome: {
      kind: "failed",
      code: "temporary",
      provider_code: "sk-live-SECRET123",
      finish_reason: "the model thought about the password hunter2",
    },
  });
  addMessage(db, { id: id("msg", 1), run, seq: 1, stored: false });
  const trace = read(db, "user", runTarget(run));
  const text = JSON.stringify(trace);
  assert(!text.includes("SECRET123") && !text.includes("hunter2"));
  assert(!text.includes(hashOf(`${id("msg", 1)}:body`)));
  assertEquals(trace.missing, [{
    kind: "body",
    reference: `${id("msg", 1)}:body`,
    reason: "reference_not_registered",
  }]);
});

Deno.test("lophn-agent/observability#R11: a partial stream stays one reference and no fragment or progress text is replayed", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, {
    id: run,
    assignment: LOPHN,
    outcome: ["failed", "model_error"],
  });
  addModel(db, {
    id: id("mcl", 1),
    run,
    order: 1,
    outcome: { kind: "partial" },
  });
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.activity.model.partial, [id("mcl", 1)]);
  assertEquals(trace.model_calls, [id("mcl", 1)]);
  assertEquals(Object.keys(trace).sort(), TRACE_KEYS);
  const text = JSON.stringify(trace);
  for (const word of ["delta", "chunk", "fragment", "progress", "text"]) {
    assert(!text.includes(word), word);
  }
});

Deno.test("lophn-agent/observability#R18: only counts, errors, time and evidence are computed; usage, cost and quality are not in the trace", () => {
  const db = ledger();
  const { run } = simpleRun(db, 1);
  const before = JSON.stringify(read(db, "user", runTarget(run)));
  // 평가 쪽 기준이 바뀌어도 trace는 같다.
  db.exec(
    "create table eval_results (run text, score integer, passed integer)",
  );
  db.prepare("insert into eval_results values (?, 5, 1)").run(run);
  db.exec("update eval_results set score = 0, passed = 0");
  const trace = read(db, "user", runTarget(run));
  assertEquals(JSON.stringify(trace), before);
  const text = JSON.stringify(trace);
  for (const word of ["score", "passed", "quality", "cost", "usage", "token"]) {
    assert(!text.includes(word), word);
  }
  assertEquals(trace.activity.model.attempts, trace.model_calls.length);
  assertEquals(trace.activity.tools.steps, trace.tool_calls.length);
});

Deno.test("lophn-agent/observability#R19: external tool calls keep success, refusal, failure and a cut-off before any reply apart", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, { id: run, assignment: LOPHN, state: "running" });
  addModel(db, { id: id("mcl", 1), run, order: 1 });
  const calls = [
    { n: 1, outcome: "success", decision: "allow", external: true },
    { n: 2, outcome: "not_executed", decision: "deny", external: true },
    { n: 3, outcome: "failure", decision: "allow", external: true },
    // 응답 전에 끊겼다: 시작은 했지만 결과 기록이 없다.
    {
      n: 4,
      outcome: null,
      decision: "allow",
      external: true,
      state: "started",
    },
    { n: 5, outcome: "success", decision: "allow", external: false },
  ] as const;
  for (const call of calls) {
    addTool(db, {
      id: id("tcl", call.n),
      run,
      modelCall: id("mcl", 1),
      order: call.n,
      outcome: call.outcome,
      decision: call.decision,
      external: call.external,
      state: "state" in call ? call.state : "finished",
    });
  }
  const trace = read(db, "user", runTarget(run));
  assertEquals(trace.assignment, LOPHN);
  assertEquals(
    trace.activity.tools.external,
    [1, 2, 3, 4].map((n) => id("tcl", n)),
  );
  assertEquals(trace.activity.tools.succeeded, 2);
  assertEquals(trace.activity.tools.denied, [id("tcl", 2)]);
  assertEquals(trace.activity.tools.failed, [id("tcl", 3)]);
  assertEquals(trace.activity.tools.unfinished, [id("tcl", 4)]);
  assert(
    trace.missing.some((entry) =>
      entry.reference === id("tcl", 4) && entry.reason === "result_not_recorded"
    ),
  );
});

Deno.test("lophn-agent/observability#R20: three actors read the same trace, a deleted original is shown as absent and out-of-scope targets answer like absent ones", () => {
  const db = ledger();
  const { run } = simpleRun(db, 1);
  addMessage(db, { id: id("msg", 5), run, seq: 11, stored: false });
  const same = read(db, "user", runTarget(run));
  assertEquals(read(db, "machine", runTarget(run)), same);
  assertEquals(read(db, `agent:${LOPHN}`, runTarget(run)), same);
  assertEquals(same.missing, [{
    kind: "body",
    reference: `${id("msg", 5)}:body`,
    reason: "reference_not_registered",
  }]);
  assertEquals(same.messages.includes(id("msg", 5)), true);

  const absent = readTrace(
    db,
    "user",
    { target: runTarget(id("run", 99)) } as never,
  );
  assert(!absent.ok && absent.error.code === "not_found");
  const asOther = readTrace(
    db,
    `agent:${ENGINEER}`,
    { target: runTarget(run) } as never,
  );
  assertEquals(asOther, absent);
  const wrongRole = readTrace(db, "user", {
    target: runTarget(run),
    role: "operator",
  } as never);
  assertEquals(wrongRole, absent);
  const outside = readTrace(db, "user", {
    target: runTarget(run),
    from_at: "2026-11-01T00:00:00.000Z",
  } as never);
  assertEquals(outside, absent);
  const inside = readTrace(db, "user", {
    target: runTarget(run),
    role: "lophn",
    from_at: T0,
    through_at: "2026-10-02T00:00:00.000Z",
  } as never);
  assert(inside.ok);
});

Deno.test("lophn-agent/observability#R21: tool activity folds to a step count and a failure among ten successes stays visible", () => {
  const db = ledger();
  const run = id("run", 1);
  addRun(db, { id: run, assignment: LOPHN, outcome: ["failed", "tool_error"] });
  addModel(db, { id: id("mcl", 1), run, order: 1 });
  for (let n = 1; n <= 12; n++) {
    const outcome = n === 4 ? "failure" : n === 9 ? "uncertain" : "success";
    addTool(db, {
      id: id("tcl", n),
      run,
      modelCall: id("mcl", 1),
      order: n,
      outcome,
    });
  }
  const trace = read(db, "user", runTarget(run));
  assertEquals(
    trace.tool_calls,
    Array.from({ length: 12 }, (_, i) => id("tcl", i + 1)),
  );
  assertEquals(trace.activity.tools.steps, 12);
  assertEquals(trace.activity.tools.succeeded, 10);
  assertEquals(trace.activity.tools.failed, [id("tcl", 4)]);
  // 끝났다는 사실만으로 성공이 되지 않는다.
  assertEquals(trace.activity.tools.uncertain, [id("tcl", 9)]);
});

Deno.test("lophn-agent/observability#R22: the trace carries references and counts only, never reasoning", () => {
  const db = ledger();
  const { run } = simpleRun(db, 1);
  const trace = read(db, "user", runTarget(run));
  const text = JSON.stringify(trace);
  for (const word of ["reasoning", "thinking", "thought", "chain"]) {
    assert(!text.includes(word), word);
  }
  assertEquals(Object.keys(trace).sort(), TRACE_KEYS);
});
