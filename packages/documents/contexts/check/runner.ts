import type { CheckInput, CheckOutcome } from "./types.ts";

// 판 하나를 snapshot에 대해 검사한다. 단계와 finding은 types.ts에 있다.
// 순수하다: 같은 snapshot과 같은 판이면 결과가 byte까지 같다.
export function runCheck(_input: CheckInput): CheckOutcome {
  throw new Error("not implemented");
}
