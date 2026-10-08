// problems/closing의 경계다. 최상위 concern 사이는 packages/contracts로만 부르고,
// 반응기 조립은 아래 모듈을 직접 부른다(apps/worker/problems/test-runner.ts).
export {
  type ClosureEvidence,
  type ConclusionBasis,
  verifiedCandidate,
  verifiedClosure,
} from "./model.ts";
export {
  closeProblemVerifiedCommand,
  handleCloseProblemVerified,
} from "./commands.ts";
export {
  CLOSING_EVENT_TYPES,
  CLOSING_SUBSCRIBER,
  type ClosingEvent,
  closingReactionKey,
  type ClosingReactionPorts,
  reactClosing,
} from "./work.ts";
export {
  type ClosingClientOptions,
  createClosingPorts,
} from "./adapters/core-client.ts";
