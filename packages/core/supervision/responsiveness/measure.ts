// 응답 측정의 순수 논리. 표본을 모으고 분포를
// 요약하고 목표와 비교한다. 시간은 전송 직전부터 완전 응답까지 잰 실제
// 경과(performance.now)와 sender가 기록한 queue 대기·실행의 분리만 온다.
// 측정 시나리오(load 표본 수집, 부하 진행)는 measure-run.ts가 맡는다.

/**
 * 요청 하나의 끝 상태. ended는 완전 응답, error는 재시도가 아니라 기록해 둔
 * 실패, timeout은 기한 안에 끝나지 않은 요청이다. 어느 요청이든 셋 가운데
 * 하나만 되고, 빠짐은 측정 누락이다.
 */
export type RequestOutcome = "ended" | "error" | "timeout";

/**
 * 한 요청의 측정. queue wait과 execution을 따로 두되, 합이 전체 시간이 아닐 수
 * 있으므로 전체는 ms에 따로 둔다. ms는 전송 직전부터 완전 응답까지의 실제 경과다.
 */
export type RequestSample = {
  outcome: RequestOutcome;
  /** 전송 직전부터 끝 상태까지의 monotonic 경과 ms. */
  ms: number;
  /** sender가 기록한 queue 대기 ms. 기록이 없으면 undefined다. */
  queueWaitMs?: number;
  /** sender가 기록한 실행 ms. 기록이 없으면 undefined다. */
  executionMs?: number;
  /** 측정 예외의 분류. 없으면 일반 요청이다. */
  exception?:
    | "slow_same_target"
    | "real_disk_save"
    | "approval_pre_admission"
    | "insufficient_resources";
};

/**
 * 측정 대상 하나. 부하 도중 healthy한 대상과 별개로 둔다.
 */
export type MeasureTarget = {
  /** 대상 이름. 목표 표의 키로도 쓴다. */
  name: string;
  /** 같은 대상의 느린 동작 예외를 표본에 남기기 위한 표지. */
  exception?: RequestSample["exception"];
};

/** 목표 백분위와 한계 p95·p99 ms. */
export type Goal = {
  p95Ms: number;
  p99Ms: number;
};

// 응답 목표. 값은 사람이 requirements 문서에서 옮기지 않았다. 대상 키는
// MeasureTarget.name이 결정한다.
export const MEASURE_GOALS: Record<string, Goal> = {
  "small_local_read": { p95Ms: 200, p99Ms: 500 },
  "app_read_command": { p95Ms: 200, p99Ms: 500 },
  "shell_first_response": { p95Ms: 100, p99Ms: 250 },
  "small_ledger_command": { p95Ms: 500, p99Ms: 1_000 },
  "document_save_64kib": { p95Ms: 500, p99Ms: 1_000 },
  "control_receipt": { p95Ms: 200, p99Ms: 500 },
} as const;

/** 측정 조건. 보고 field다. */
export type MeasureConditions = {
  /** 기준 장치 이름. 사람이 stack.md의 값으로 채운다. */
  device: string;
  os: string;
  /** 측정한 데이터 규모. 예: root 파일 개수, 문서 폴더 크기. */
  dataScale: string;
  /** 같은 대상의 동시 요청 개수. */
  concurrency: number;
};

/** 분포 요약. p50·p95·p99·max. 성공 종료만 센다. */
export type Distribution = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

/** 큰 지연의 이유를 안전하게 남긴다. 값은 ms 단위 숫자만 온다. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.min(Math.max(index, 0), sorted.length - 1);
  return sorted[clamped];
}

/** 표본에 분포를 요약한다. ended 표본만 분포에 들어간다. */
export function summarize(samples: readonly RequestSample[]): Distribution {
  const ended = samples.filter((sample) => sample.outcome === "ended").map(
    (sample) => sample.ms,
  ).sort((a, b) => a - b);
  return {
    count: ended.length,
    p50Ms: percentile(ended, 50),
    p95Ms: percentile(ended, 95),
    p99Ms: percentile(ended, 99),
    maxMs: ended.length ? ended[ended.length - 1] : 0,
  };
}

/** queue 대기와 실행의 요약. 기록이 있는 표본만 따로 요약한다. */
export type SplitSummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

/** 표본의 queue 대기·실행 분포를 따로 요약한다. 기록이 없는 표본은 빠진다. */
export function summarizeSplit(
  samples: readonly RequestSample[],
  pick: (sample: RequestSample) => number | undefined,
): SplitSummary {
  const values = samples.filter((sample) => sample.outcome === "ended").map(
    pick,
  ).filter((value): value is number => value !== undefined).sort((
    a,
    b,
  ) => a - b);
  return {
    count: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: values.length ? values[values.length - 1] : 0,
  };
}

/**
 * 목표 판정. p95·p99가 목표 이하이면 통과다. 오류·timeout 표본은 성공 분포에
 * 안 들어가고 따로 셈하므로, 결과로 그 사실을 다시 덮지 않는다.
 */
export type Judgment = {
  target: string;
  goal: Goal;
  p95Met: boolean;
  p99Met: boolean;
};

/** 대상 하나의 목표 판정. 목표가 없는 대상은 undefined다. */
export function judge(
  targetName: string,
  summary: Distribution,
): Judgment | undefined {
  const goal = MEASURE_GOALS[targetName];
  if (!goal) return undefined;
  return {
    target: targetName,
    goal,
    p95Met: summary.count > 0 && summary.p95Ms <= goal.p95Ms,
    p99Met: summary.count > 0 && summary.p99Ms <= goal.p99Ms,
  };
}
