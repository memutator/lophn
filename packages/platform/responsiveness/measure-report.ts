// 측정 결과 보고의 순수 논리(docs/plan/platform.md T51 두 번째 확인). 대상별
// 요약·목표 판정·측정 조건을 한 보고로 모은다. 오류를 빠른 성공으로 계산하지
// 않는다(R8): outcome 개수는 분포와 별개로 남기고, 모든 요청은 어느 끝 상태든
// 가진다(R8, R10).

import {
  type Distribution,
  type Goal,
  judge,
  type Judgment,
  type MeasureConditions,
  type RequestSample,
  summarize,
  summarizeSplit,
} from "./measure.ts";

/** 대상 하나의 결과. 요약·판정·끝 상태 개수와 예외 기록을 함께 둔다. */
export type TargetReport = {
  target: string;
  distribution: Distribution;
  judgment?: Judgment;
  /** 성공·오류·timeout을 따로 센다. 오류는 성공 분포에 들어가지 않는다. */
  ended: number;
  errors: number;
  timeouts: number;
  /** queue 대기·실행 분포. 기록된 표본만 포함한다(R8). */
  queueWait?: { p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  execution?: { p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  /** 측정 예외를 분류해 남긴다(R10). */
  exceptions?: { kind: string; count: number }[];
};

/** 측정 보고 하나. 조건과 대상별 결과를 함께 둔다. */
export type MeasureReport = {
  conditions: MeasureConditions;
  targets: TargetReport[];
  /** 모든 요청이 끝 상태를 가지는지. 거짓이면 측정 누락이다(R8). */
  complete: boolean;
};

/** 대상별 요청 표본 묶음. 시나리오가 이 모양으로 결과를 넘긴다. */
export type TargetSamples = {
  target: string;
  samples: readonly RequestSample[];
};

/** 예외를 분류해 개수로 모은다. */
function countExceptions(
  samples: readonly RequestSample[],
): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    if (sample.exception === undefined) continue;
    counts.set(sample.exception, (counts.get(sample.exception) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

/** 대상 표본을 결과 하나로 요약한다. */
export function reportTarget(entry: TargetSamples): TargetReport {
  const distribution = summarize(entry.samples);
  const judgment = judge(entry.target, distribution);
  const queueWait = summarizeSplit(
    entry.samples,
    (sample) => sample.queueWaitMs,
  );
  const execution = summarizeSplit(
    entry.samples,
    (sample) => sample.executionMs,
  );
  let ended = 0;
  let errors = 0;
  let timeouts = 0;
  for (const sample of entry.samples) {
    if (sample.outcome === "ended") ended++;
    else if (sample.outcome === "error") errors++;
    else if (sample.outcome === "timeout") timeouts++;
  }
  const exceptions = countExceptions(entry.samples);
  return {
    target: entry.target,
    distribution,
    ...(judgment ? { judgment } : {}),
    ended,
    errors,
    timeouts,
    ...(queueWait.count > 0 ? { queueWait } : {}),
    ...(execution.count > 0 ? { execution } : {}),
    ...(exceptions.length > 0 ? { exceptions } : {}),
  };
}

/** 끝 상태가 없는 요청이 있는지. 있으면 보고가 불완전이다(R8). */
export function isComplete(entries: readonly TargetSamples[]): boolean {
  return entries.every((entry) =>
    entry.samples.every((sample) =>
      sample.outcome === "ended" || sample.outcome === "error" ||
      sample.outcome === "timeout"
    )
  );
}

/** 보고를 모은다. 조건은 사람이 채우고, 대상 순서는 들어온 순서다. */
export function buildReport(
  conditions: MeasureConditions,
  entries: readonly TargetSamples[],
): MeasureReport {
  return {
    conditions,
    targets: entries.map(reportTarget),
    complete: isComplete(entries),
  };
}

/** 목표를 어기는 대상만 고른다. 오류·timeout이 있어도 목표 이하면 고르지 않는다. */
export function unmetTargets(report: MeasureReport): TargetReport[] {
  return report.targets.filter(
    (target) =>
      target.judgment !== undefined &&
      (!target.judgment.p95Met || !target.judgment.p99Met),
  );
}

/** 보고를 읽는 사람이 목표 이하와 끝 상태 개수를 한눈에 보는 줄이다. */
export function formatTargetLine(target: TargetReport): string {
  const judgment = target.judgment;
  const met = judgment === undefined
    ? "목표 없음"
    : judgment.p95Met && judgment.p99Met
    ? "통과"
    : "미달";
  return `${target.target}: p50 ${target.distribution.p50Ms}ms · p95 ${
    judgment ? target.distribution.p95Ms : target.distribution.p95Ms
  }ms(목표 ${
    judgment ? judgment.goal.p95Ms : "-"
  }ms) · p99 ${target.distribution.p99Ms}ms · max ${target.distribution.maxMs}ms · 성공 ${target.ended} · 오류 ${target.errors} · timeout ${target.timeouts} · ${met}`;
}

/** 보고 전체를 사람이 읽는 문단으로 묶는다. */
export function formatReport(report: MeasureReport): string {
  const lines = [
    `장치 ${report.conditions.device} · ${report.conditions.os} · 데이터 ${report.conditions.dataScale} · 동시 ${report.conditions.concurrency}`,
    ...report.targets.map(formatTargetLine),
    `측정 누락: ${
      report.complete ? "없다" : "있다(모든 요청의 끝 상태를 기록한다)"
    }`,
  ];
  return lines.join("\n");
}

/** Goal 참조를 위한 재노출. 판정을 다시 만들지 않고 목표만 본다. */
export type { Goal, Judgment };
