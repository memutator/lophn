import { assert, assertEquals } from "@std/assert";
import { formatAt } from "@lophn/base";
import {
  REPORT_RETRY_DELAYS_MS,
  REPORTING_LIMITS,
} from "@lophn/protocol/problems/sdk-report";
import type {
  ObservationInvocationEvidence,
  ReportAcceptance,
  ReportProblemInput,
  ReportTransport,
  ReportTransportError,
} from "@lophn/protocol/problems/sdk-report";
import { createProblemReporter } from "./reporter.ts";

const START = Date.parse("2026-10-04T12:00:00.000Z");

function idSource() {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `${prefix}_${n.toString(36).padStart(26, "0")}`;
  };
}

function harness(transport: ReportTransport) {
  const sleeps: number[] = [];
  let invocation: ObservationInvocationEvidence | null = null;
  const reporter = createProblemReporter({
    transport,
    now: () => formatAt(START),
    newId: idSource(),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    currentInvocation: () => invocation,
  });
  return {
    reporter,
    sleeps,
    setInvocation(value: ObservationInvocationEvidence | null) {
      invocation = value;
    },
  };
}

const acceptance: ReportAcceptance = {
  report: "rpt_00000000000000000000000001",
  snapshot: "snp_00000000000000000000000001",
  problem: "prb_00000000000000000000000001",
  diagnostic_scope: null,
};

function sent(
  result: { ok: true; value: ReportAcceptance } | {
    ok: false;
    error: ReportTransportError;
  },
): ReportTransport {
  return () => Promise.resolve(result);
}

Deno.test("problems/reporting#R1: reportProblem은 첫 전송 전에 Report ID와 실제 invocation 문맥을 고정한다", async () => {
  const seen: ReportProblemInput[] = [];
  let release: (value: Awaited<ReturnType<ReportTransport>>) => void = () => {};
  const { reporter, setInvocation } = harness(
    (input) =>
      new Promise((resolve) => {
        seen.push(input);
        release = resolve;
      }),
  );
  const context: ObservationInvocationEvidence = {
    id: "inv_00000000000000000000000001",
    binding: "sdk_context",
    record_missing_reason: { reason: "record not arrived" },
  };
  setInvocation(context);
  const report = reporter("save_failed", { field: "name" });
  assertEquals(report.report_id, "rpt_00000000000000000000000001");
  assertEquals(seen.length, 1);
  assertEquals(seen[0].report_id, report.report_id);
  assertEquals(seen[0].invocation, context);
  assertEquals(seen[0].observed_at, "2026-10-04T12:00:00.000Z");
  assertEquals(reporter.status(report.report_id), { status: "pending" });
  // 문맥 provider가 나중에 바뀌어도 이미 고정한 입력은 그대로다.
  setInvocation(null);
  release({ ok: true, value: acceptance });
  assertEquals(await report.completion, {
    status: "accepted",
    acceptance,
  });
  assertEquals(seen[0].invocation, context);
  assertEquals(reporter.status(report.report_id), null);
});

Deno.test("problems/reporting#R1: invocation 문맥이 없으면 null이고 시간 근접으로 만들지 않는다", async () => {
  const seen: ReportProblemInput[] = [];
  const { reporter } = harness(sent({ ok: true, value: acceptance }));
  const wrapped: ReportTransport = (input) => {
    seen.push(input);
    return Promise.resolve({ ok: true, value: acceptance });
  };
  const own = harness(wrapped);
  const report = own.reporter("save_failed");
  await report.completion;
  assertEquals(seen[0].invocation, null);
  assert(reporter !== own.reporter);
});

Deno.test("problems/reporting#R13: completion은 전송 실패를 값으로 끝내고 reject하지 않는다", async () => {
  const rejections: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => {
    rejections.push(event.reason);
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onRejection);
  try {
    const { reporter } = harness(
      () => Promise.reject(new Error("socket dropped")),
    );
    const report = reporter("save_failed", { field: "name" });
    const completion = await report.completion;
    await Promise.resolve();
    assertEquals(completion, {
      status: "failed",
      reason: { code: "response_lost", message: "report response lost" },
    });
    assertEquals(rejections, []);
  } finally {
    globalThis.removeEventListener("unhandledrejection", onRejection);
  }
});

Deno.test("problems/reporting#R13: 대기·전송 실패·접수를 completion 값으로 구별한다", async () => {
  let release: (value: Awaited<ReturnType<ReportTransport>>) => void = () => {};
  const { reporter } = harness(
    () => new Promise((resolve) => release = resolve),
  );
  const report = reporter("save_failed");
  assertEquals(reporter.status(report.report_id), { status: "pending" });
  release({
    ok: false,
    error: { code: "forbidden", message: "other app" },
  });
  assertEquals(await report.completion, {
    status: "failed",
    reason: { code: "forbidden", message: "other app" },
  });
  assertEquals(reporter.status(report.report_id), null);
});

Deno.test("problems/reporting#R13: retry는 같은 고정 입력만 다시 보내고 원래 command를 다시 부르지 않는다", async () => {
  const seen: ReportProblemInput[] = [];
  let calls = 0;
  const { reporter, sleeps } = harness((input) => {
    seen.push(input);
    calls += 1;
    if (calls < 4) {
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "try later" },
      });
    }
    return Promise.resolve({ ok: true, value: acceptance });
  });
  let commandCalls = 0;
  const command = () => {
    commandCalls += 1;
    return reporter("save_failed", { field: "name" });
  };
  const report = command();
  assertEquals(await report.completion, {
    status: "accepted",
    acceptance,
  });
  assertEquals(commandCalls, 1);
  assertEquals(calls, 4);
  assertEquals(sleeps, [...REPORT_RETRY_DELAYS_MS]);
  assertEquals(seen.length, 4);
  for (const input of seen) assertEquals(input, seen[0]);
  assert(Object.isFrozen(seen[0]));
});

Deno.test("problems/reporting#R16: 응답 유실도 250/1,000/3,000ms로 최대 3회 retry하고 그 뒤 멈춘다", async () => {
  let calls = 0;
  const { reporter, sleeps } = harness(() => {
    calls += 1;
    return Promise.reject(new Error("no response"));
  });
  const report = reporter("save_failed");
  assertEquals(await report.completion, {
    status: "failed",
    reason: { code: "response_lost", message: "report response lost" },
  });
  assertEquals(calls, 4);
  assertEquals(sleeps, [250, 1_000, 3_000]);
});

Deno.test("problems/reporting#R16: 일시적이지 않은 실패는 retry하지 않는다", async () => {
  let calls = 0;
  const { reporter, sleeps } = harness(() => {
    calls += 1;
    return Promise.resolve({
      ok: false,
      error: { code: "invalid_input", message: "undeclared code" },
    });
  });
  const report = reporter("no_such_code");
  assertEquals((await report.completion).status, "failed");
  assertEquals(calls, 1);
  assertEquals(sleeps, []);
});

Deno.test("problems/reporting#R16: 대기 32개를 넘기면 새 입력을 즉시 거절하고 디스크에 쓰지 않는다", async () => {
  const held: Array<(value: Awaited<ReturnType<ReportTransport>>) => void> = [];
  const { reporter } = harness(
    () => new Promise((resolve) => held.push(resolve)),
  );
  const reports = [];
  for (let i = 0; i < REPORTING_LIMITS.sdk_pending_count; i++) {
    reports.push(reporter("save_failed", { n: i }));
  }
  assertEquals(held.length, REPORTING_LIMITS.sdk_pending_count);
  const refused = reporter("save_failed", { n: "one more" });
  assertEquals(held.length, REPORTING_LIMITS.sdk_pending_count);
  assertEquals(await refused.completion, {
    status: "failed",
    reason: { code: "unavailable", message: "sdk report queue is full" },
  });
  assert(refused.report_id !== reports[0].report_id);
  // 거절은 transport를 부르지 않으므로 디스크에 남길 내용도 없다.
  assertEquals(reporter.status(refused.report_id), null);
  for (const release of held) release({ ok: true, value: acceptance });
  await Promise.all(reports.map((report) => report.completion));
});

Deno.test("problems/reporting#R16: 대기 4,194,304 bytes를 넘기면 새 입력을 거절한다", async () => {
  // 3개가 한도 안에 들어가고 4번째는 넘도록 본문 크기를 맞춘다.
  const one = Math.floor(REPORTING_LIMITS.sdk_pending_bytes / 4);
  const held: Array<(value: Awaited<ReturnType<ReportTransport>>) => void> = [];
  const seen: ReportProblemInput[] = [];
  const { reporter } = harness(
    (input) =>
      new Promise((resolve) => {
        seen.push(input);
        held.push(resolve);
      }),
  );
  const reports = [];
  for (let i = 0; i < 3; i++) {
    reports.push(reporter("save_failed", { blob: "x".repeat(one) }));
  }
  const used = seen.reduce(
    (sum, input) =>
      sum + new TextEncoder().encode(JSON.stringify(input)).length,
    0,
  );
  assert(used <= REPORTING_LIMITS.sdk_pending_bytes);
  const refused = reporter("save_failed", { blob: "x".repeat(one) });
  assertEquals(await refused.completion, {
    status: "failed",
    reason: {
      code: "unavailable",
      message: "sdk report queue byte limit exceeded",
    },
  });
  assertEquals(held.length, 3);
  for (const release of held) release({ ok: true, value: acceptance });
  await Promise.all(reports.map((report) => report.completion));
});

Deno.test("problems/reporting#R1: 보고는 업무 응답을 막지 않고 completion과 따로 끝난다", async () => {
  let release: (value: Awaited<ReturnType<ReportTransport>>) => void = () => {};
  const { reporter } = harness(
    () => new Promise((resolve) => release = resolve),
  );
  let commandFinished = false;
  const command = () => {
    const report = reporter("save_failed");
    commandFinished = true;
    return report;
  };
  const report = command();
  assert(commandFinished);
  let completed = false;
  const pending = report.completion.then(() => completed = true);
  await Promise.resolve();
  assertEquals(completed, false);
  release({ ok: true, value: acceptance });
  await pending;
  assertEquals(completed, true);
});

Deno.test("problems/reporting#R13: clone할 수 없는 details는 업무 경로에 throw하지 않고 실패 값으로 끝난다", async () => {
  let sent = 0;
  const report = createProblemReporter({
    transport: () => {
      sent++;
      return Promise.reject(new Error("unused"));
    },
    now: () => "2026-10-05T00:00:00.000Z",
    newId: () => "rpt_00000000000000000000000009",
    sleep: () => Promise.resolve(),
    currentInvocation: () => null,
  });
  const bad = { fn: () => 1 } as unknown as Record<string, never>;
  const result = report("app.broken", bad);
  assertEquals(result.report_id, "rpt_00000000000000000000000009");
  const completion = await result.completion;
  assertEquals(completion.status, "failed");
  if (completion.status === "failed") {
    assertEquals(completion.reason.code, "invalid_input");
  }
  assertEquals(sent, 0);
});
