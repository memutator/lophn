import { RUNNER_LIMITS } from "./limits.ts";

export type AttemptRecord = {
  request_key: string;
  // ledger에 확정된 시작 시도. 이 시각이 없으면 spawn하지 않는다.
  start_attempt_at: string | null;
  // 실제 시작을 관측했는가. null이면 시작 여부를 모른다.
  started: boolean | null;
  runner: string;
};

export type LostRun = {
  request_key: string;
  verdict: "inconclusive";
  reason: "runner_lost";
  // 같은 요청을 다시 시작하지 않는다.
  restart: false;
};

// runner가 죽으면 감독이 자식을 회수하고, 실제 시작한 요청만 runner_lost로 남긴다.
// 시작하지 않은 요청과 시작 여부를 모르는 요청은 Verification을 만들지 않는다
// (problems/tests#R17, R21).
export function recoverLostRunner(
  attempts: readonly AttemptRecord[],
  deadRunner: string,
): { lost: LostRun[]; unknown: string[] } {
  const lost: LostRun[] = [];
  const unknown: string[] = [];
  for (const attempt of attempts) {
    if (attempt.runner !== deadRunner) continue;
    if (attempt.started === true && attempt.start_attempt_at) {
      lost.push({
        request_key: attempt.request_key,
        verdict: "inconclusive",
        reason: "runner_lost",
        restart: false,
      });
    } else if (attempt.started === null) {
      unknown.push(attempt.request_key);
    }
  }
  return { lost, unknown };
}

export type Admission = "admit" | "unavailable";

// 실제 실행 2개, 준비 대기 16개. 대기가 넘치면 접수 전 unavailable이다
// (problems/tests#R20). 실행 자리가 없어도 대기가 상한 안이면 접수는 받는다.
export function admitQueue(running: number, preparing: number): Admission {
  if (preparing >= RUNNER_LIMITS.preparing) return "unavailable";
  if (
    running >= RUNNER_LIMITS.concurrent && preparing >= RUNNER_LIMITS.preparing
  ) {
    return "unavailable";
  }
  return "admit";
}
