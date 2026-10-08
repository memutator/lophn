export {
  type JsonValue,
  type Matcher,
  matches,
  type ObservedProbe,
  type ReproductionFrozen,
  reproductionFrozen,
  type ReproductionScenario,
  type SymptomParts,
  symptomParts,
} from "./scenario.ts";
export {
  ADJACENT_FRAME,
  judgeReproduction,
  type ReproductionJudgment,
  type ReproductionObservations,
  type ReproductionSide,
  type SideObservation,
  type SideRun,
  SYMPTOM_FRAME,
} from "./judge.ts";
export { observeReproduction, toObserved } from "./observe.ts";
// 자식 진입(child.ts)은 동기 file API를 쓰므로 core가 import하는 이 묶음에 내보내지 않는다.
