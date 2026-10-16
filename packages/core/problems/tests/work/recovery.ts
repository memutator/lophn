import { RUNNER_LIMITS } from "./limits.ts";

// runner가 죽으면 감독이 자식을 회수하고, 실제 시작한 요청만 runner_lost로 남긴다.
// 시작하지 않은 요청과 시작 여부를 모르는 요청은 Verification을 만들지 않는다.

export type Admission = "admit" | "unavailable";

// 실제 실행 2개, 준비 대기 16개. 대기가 넘치면 접수 전 unavailable이다.
// 실행 slot이 없어도 대기가 상한 안이면 접수는 받는다.
export function admitQueue(running: number, preparing: number): Admission {
  if (preparing >= RUNNER_LIMITS.preparing) return "unavailable";
  if (
    running >= RUNNER_LIMITS.concurrent && preparing >= RUNNER_LIMITS.preparing
  ) {
    return "unavailable";
  }
  return "admit";
}
