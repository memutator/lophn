// 측정 harness 자체의 순수 논리 테스트(docs/plan/platform.md T51). 분포
// 요약·목표 판정·보고 모양·시나리오 진행만 본다. 실제 core 전송은 opt-in
// 시나리오(measure-scenario.ts)의 몫이라 여기 없다.
import { assert, assertEquals } from "@std/assert";

import { buildReport, reportTarget, unmetTargets } from "./measure-report.ts";
import { judge, MEASURE_GOALS, summarize, summarizeSplit } from "./measure.ts";
import { runScenario } from "./measure-run.ts";

Deno.test("platform/responsiveness#R8: 분포 요약은 p50·p95·p99·max를 ended 표본만으로 낸다", () => {
  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms) => ({
    outcome: "ended" as const,
    ms,
  }));
  const summary = summarize(samples);
  assertEquals(summary.count, 10);
  assertEquals(summary.p50Ms, 50);
  assertEquals(summary.p95Ms, 100);
  assertEquals(summary.p99Ms, 100);
  assertEquals(summary.maxMs, 100);
});

Deno.test("platform/responsiveness#R8: 오류·timeout 표본은 성공 분포에 들어가지 않는다", () => {
  const samples = [
    ...[10, 20, 30, 40].map((ms) => ({ outcome: "ended" as const, ms })),
    {
      outcome: "error" as const,
      ms: 900,
      exception: "slow_same_target" as const,
    },
    { outcome: "timeout" as const, ms: 9_000 },
  ];
  const summary = summarize(samples);
  assertEquals(summary.count, 4);
  assertEquals(summary.maxMs, 40);
});

Deno.test("platform/responsiveness#R8: ended 표본이 없으면 요약은 0이고 count만 본다", () => {
  const summary = summarize([
    { outcome: "error" as const, ms: 100 },
    { outcome: "timeout" as const, ms: 100 },
  ]);
  assertEquals(summary.count, 0);
  assertEquals(summary.p50Ms, 0);
  assertEquals(summary.maxMs, 0);
});

Deno.test("platform/responsiveness#R8: queue 대기와 실행 분포를 따로 요약한다", () => {
  const samples = [
    { outcome: "ended" as const, ms: 100, queueWaitMs: 30, executionMs: 70 },
    { outcome: "ended" as const, ms: 120, queueWaitMs: 10, executionMs: 110 },
    { outcome: "ended" as const, ms: 140 },
  ];
  const wait = summarizeSplit(samples, (sample) => sample.queueWaitMs);
  const execution = summarizeSplit(samples, (sample) => sample.executionMs);
  assertEquals(wait.count, 2);
  assertEquals(wait.p95Ms, 30);
  assertEquals(execution.count, 2);
  assertEquals(execution.p95Ms, 110);
});

Deno.test(
  "platform/responsiveness#R6: 작은 로컬 read·앱 read command의 목표는 p95 200ms·p99 500ms다",
  () => {
    assertEquals(MEASURE_GOALS["small_local_read"], { p95Ms: 200, p99Ms: 500 });
    assertEquals(MEASURE_GOALS["app_read_command"], { p95Ms: 200, p99Ms: 500 });
  },
);

Deno.test(
  "platform/responsiveness#R6: shell 첫 반응의 목표는 p95 100ms·p99 250ms다",
  () => {
    assertEquals(MEASURE_GOALS["shell_first_response"], {
      p95Ms: 100,
      p99Ms: 250,
    });
  },
);

Deno.test(
  "platform/responsiveness#R7: 작은 command·64KiB 저장의 목표는 p95 500ms·p99 1,000ms다",
  () => {
    assertEquals(MEASURE_GOALS["small_ledger_command"], {
      p95Ms: 500,
      p99Ms: 1_000,
    });
    assertEquals(MEASURE_GOALS["document_save_64kib"], {
      p95Ms: 500,
      p99Ms: 1_000,
    });
  },
);

Deno.test(
  "platform/responsiveness#R7: 제어 접수의 목표는 p95 200ms·p99 500ms다",
  () => {
    assertEquals(MEASURE_GOALS["control_receipt"], { p95Ms: 200, p99Ms: 500 });
  },
);

Deno.test("platform/responsiveness#R6: p95·p99가 목표 이하면 판정은 통과다", () => {
  const summary = summarize(
    Array.from({ length: 100 }, (_, index) => ({
      outcome: "ended" as const,
      ms: Math.floor(index / 5),
    })),
  );
  const judgment = judge("small_local_read", summary);
  assertEquals(judgment?.p95Met, true);
  assertEquals(judgment?.p99Met, true);
});

Deno.test("platform/responsiveness#R6: p95가 목표를 넘으면 판정은 미달이다", () => {
  const summary = summarize(
    Array.from({ length: 100 }, (_, index) => ({
      outcome: "ended" as const,
      ms: 300 + index,
    })),
  );
  const judgment = judge("small_local_read", summary);
  assertEquals(judgment?.p95Met, false);
  assertEquals(judgment?.p99Met, true);
});

Deno.test("platform/responsiveness#R8: ended 표본이 없으면 판정은 미달이다(빠진 측정은 성공이 아니다)", () => {
  const judgment = judge("small_local_read", {
    count: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxMs: 0,
  });
  assertEquals(judgment?.p95Met, false);
  assertEquals(judgment?.p99Met, false);
});

Deno.test("platform/responsiveness#R6: 목표 밖 대상은 판정을 내지 않는다", () => {
  assertEquals(judge("unknown_target", summarize([])), undefined);
});

Deno.test("platform/responsiveness#R8: 보고는 조건·대상별 끝 상태 개수·분포를 함께 남긴다", () => {
  const report = buildReport(
    { device: "test", os: "linux", dataScale: "empty", concurrency: 2 },
    [{
      target: "small_local_read",
      samples: [
        ...Array.from({ length: 9 }, () => ({
          outcome: "ended" as const,
          ms: 10,
          queueWaitMs: 2,
          executionMs: 8,
        })),
        {
          outcome: "error" as const,
          ms: 500,
          exception: "real_disk_save" as const,
        },
        { outcome: "timeout" as const, ms: 5_000 },
      ],
    }],
  );
  assertEquals(report.conditions, {
    device: "test",
    os: "linux",
    dataScale: "empty",
    concurrency: 2,
  });
  assertEquals(report.complete, true);
  const [target] = report.targets;
  assertEquals(target.ended, 9);
  assertEquals(target.errors, 1);
  assertEquals(target.timeouts, 1);
  assertEquals(target.distribution.count, 9);
  assertEquals(target.exceptions, [{ kind: "real_disk_save", count: 1 }]);
});

Deno.test("platform/responsiveness#R10: 예외 분류는 보고에 따로 남는다", () => {
  const target = reportTarget({
    target: "document_save_64kib",
    samples: [
      { outcome: "ended" as const, ms: 100, exception: "real_disk_save" },
      { outcome: "ended" as const, ms: 110, exception: "real_disk_save" },
      {
        outcome: "ended" as const,
        ms: 120,
        exception: "approval_pre_admission",
      },
      { outcome: "ended" as const, ms: 130 },
    ],
  });
  assertEquals(target.exceptions, [
    { kind: "real_disk_save", count: 2 },
    { kind: "approval_pre_admission", count: 1 },
  ]);
});

Deno.test("platform/responsiveness#R8: 끝 상태가 없는 표본이 있으면 보고는 불완전이다", () => {
  const report = buildReport(
    { device: "t", os: "linux", dataScale: "d", concurrency: 1 },
    [{
      target: "small_local_read",
      samples: [{ outcome: "error" as const, ms: 10 }] as never,
    }],
  );
  assertEquals(report.complete, true);
  const broken = buildReport(
    { device: "t", os: "linux", dataScale: "d", concurrency: 1 },
    [{
      target: "small_local_read",
      samples: [{ outcome: "unknown" as never, ms: 10 }],
    }],
  );
  assertEquals(broken.complete, false);
});

Deno.test("platform/responsiveness#R6: 목표 미달 대상만 미달로 고른다", () => {
  const report = buildReport(
    { device: "t", os: "linux", dataScale: "d", concurrency: 1 },
    [
      {
        target: "small_local_read",
        samples: [{ outcome: "ended" as const, ms: 50 }],
      },
      {
        target: "shell_first_response",
        samples: Array.from({ length: 20 }, () => ({
          outcome: "ended" as const,
          ms: 300,
        })),
      },
    ],
  );
  const unmet = unmetTargets(report);
  assertEquals(unmet.length, 1);
  assertEquals(unmet[0].target, "shell_first_response");
});

Deno.test("platform/responsiveness#R10: 미달 보고의 줄은 목표와 끝 상태 개수를 함께 보여 준다", () => {
  const report = buildReport(
    { device: "t", os: "linux", dataScale: "d", concurrency: 1 },
    [{
      target: "small_local_read",
      samples: Array.from({ length: 20 }, () => ({
        outcome: "ended" as const,
        ms: 250,
      })),
    }],
  );
  const line = report.targets.map((target) =>
    `${target.target} p95=${target.distribution.p95Ms} 목표=${target.judgment?.goal.p95Ms} ${
      target.judgment?.p95Met ? "통과" : "미달"
    }`
  ).join("\n");
  assert(line.includes("p95=250"));
  assert(line.includes("목표=200"));
  assert(line.includes("미달"));
});

Deno.test("platform/responsiveness#R8: 시나리오는 warm-up을 ended 표본에 넣지 않는다", async () => {
  let sends = 0;
  const result = await runScenario(
    {
      target: "small_local_read",
      warmup: 3,
      repetitions: 4,
    },
    () => {
      sends++;
      return Promise.resolve({ outcome: "ended" as const, ms: 20 + sends });
    },
    () => Promise.resolve(),
    { nowMs: () => 0 },
  );
  assertEquals(result.target, "small_local_read");
  assertEquals(result.warmups, 3);
  assertEquals(result.samples.length, 4);
  assertEquals(
    result.samples.every((sample) => sample.outcome === "ended"),
    true,
  );
});

Deno.test("platform/responsiveness#R10: 실패한 시도는 예외 분류와 함께 표본에 남는다", async () => {
  let sends = 0;
  const result = await runScenario(
    {
      target: "small_local_read",
      warmup: 0,
      repetitions: 3,
      exception: "insufficient_resources",
    },
    () => {
      sends++;
      if (sends === 2) {
        return Promise.resolve({
          outcome: "error" as const,
          ms: 400,
          reason: "거절",
        });
      }
      return Promise.resolve({ outcome: "ended" as const, ms: 10 });
    },
    () => Promise.resolve(),
    { nowMs: () => sends * 100 },
  );
  assertEquals(result.samples.length, 3);
  assertEquals(result.samples[1].outcome, "error");
  assertEquals(result.samples[1].exception, "insufficient_resources");
  assertEquals(result.samples[0].outcome, "ended");
});
