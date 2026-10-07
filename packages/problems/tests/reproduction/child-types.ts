// reproduction test 자식의 입력 모양이다. 자식 본문(child.ts)은 동기 file API를 쓰는 test 자식 전용 코드라 core module
// graph에 들어가지 않게 하고, 이 모양만 mod.ts로 내보낸다.
import type { ReproductionSide } from "./judge.ts";
import type { ReproductionScenario } from "./scenario.ts";

export type ReproductionChildInput = {
  side: ReproductionSide;
  test_hash: string;
  scenario: ReproductionScenario;
};
