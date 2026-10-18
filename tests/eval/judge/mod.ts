export {
  JUDGE_FILES,
  type JudgeDefinition,
  loadJudgeDefinition,
} from "./definition.ts";
export { asksGapInput, joinInput, relayCompleteInput } from "./input.ts";
export {
  type JudgeFetch,
  judgeItem,
  judgePassed,
  quoteInInput,
} from "./run.ts";
