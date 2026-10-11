// context.preview의 순수 함수. 구현 전(spec)이라 `not implemented`다.
//
// 구현은 격리 검사의 추출·위반 경로를 그대로 쓴다(check/runner.ts의 모양·의미 검사, extractAll,
// checkEntities, 예, saved view). 다른 점은 셋뿐이다. (1) 개체 수를 type별로 센다(check 결과에는 없으므로
// runner가 개체를 함께 내도록 고치거나 단계를 나눠 쓴다). (2) 사람이 저장한 saved view를 부르지 않는다.
// (3) 결과는 어디에도 쓰지 않는다. 판·index·ledger를 만지는 port를 받지 않는다.
import type { PreviewInput, PreviewOutcome } from "./types.ts";

export function previewDraft(_input: PreviewInput): PreviewOutcome {
  throw new Error("not implemented: previewDraft");
}
