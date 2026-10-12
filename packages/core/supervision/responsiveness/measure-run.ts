// 측정 시나리오의 순수 진행(docs/plan/platform.md T51 세 번째 확인). 대상별
// warm-up 뒤 반복 요청을 진행하고 표본을 기록한다. 실제 전송과 시간은 driver가
// 주입하므로, 시나리오 모양 자체(각 표본에 끝 상태가 있고 예외가 분류되는 것)는
// 빠른 테스트로 확인한다. 실제 core를 띄우는 실행은 measure-scenario.ts가 맡는다.

import { type RequestOutcome, type RequestSample } from "./measure.ts";

/** 대상 하나를 보내는 driver. 시나리오가 실제 요청을 여기서 옮긴다. */
export type SendRequest = () => Promise<
  | { outcome: "ended"; ms: number; queueWaitMs?: number; executionMs?: number }
  | { outcome: "error"; ms: number; reason: string }
  | { outcome: "timeout"; ms: number }
>;

/** 시나리오 옵션. warm-up 뒤 반복 횟수를 정한다. */
export type ScenarioOptions = {
  /** 대상 이름. 결과 정리의 키다. */
  target: string;
  warmup: number;
  repetitions: number;
  /** 실패한 표본의 분류. 없으면 일반 요청이다. */
  exception?: RequestSample["exception"];
};

/** 시나리오 진행 결과. 모든 표본에 끝 상태가 있다. */
export type ScenarioResult = {
  target: string;
  warmups: number;
  samples: RequestSample[];
};

/** monotonic 시각. driver가 주입해 frozen clock에도 표본이 기록된다. */
export type ScenarioClock = { nowMs(): number };

/** warm-up 뒤 반복 요청을 진행하고 표본을 모은다. */
export async function runScenario(
  options: ScenarioOptions,
  send: SendRequest,
  sleep: (ms: number) => Promise<void>,
  clock: ScenarioClock,
): Promise<ScenarioResult> {
  for (let index = 0; index < options.warmup; index++) {
    await send();
    await sleep(0);
  }
  const samples: RequestSample[] = [];
  for (let index = 0; index < options.repetitions; index++) {
    const sentAt = clock.nowMs();
    const attempt = await send();
    const elapsed = clock.nowMs() - sentAt;
    const outcome: RequestOutcome = attempt.outcome;
    // 실패한 시도는 reason을 예외 기록으로 남긴다. 기록된 표본에 끝 상태가 있다.
    const reason = attempt.outcome === "error" ? attempt.reason : undefined;
    samples.push({
      outcome,
      // ms는 전송 직전부터 끝 상태까지의 실제 경과다. sender가 기록한 값이
      // 있으면 그 값을 쓴다(전송 비용이 측정 코드에 섞이지 않게).
      ms: attempt.outcome === "ended" ? attempt.ms : elapsed,
      ...(attempt.outcome === "ended" && attempt.queueWaitMs !== undefined
        ? { queueWaitMs: attempt.queueWaitMs }
        : {}),
      ...(attempt.outcome === "ended" && attempt.executionMs !== undefined
        ? { executionMs: attempt.executionMs }
        : {}),
      ...(reason !== undefined || options.exception !== undefined
        ? { exception: options.exception ?? "slow_same_target" }
        : {}),
    });
    await sleep(0);
  }
  return {
    target: options.target,
    warmups: options.warmup,
    samples,
  };
}
