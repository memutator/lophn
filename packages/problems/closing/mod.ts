// problems/closing의 경계다. 최상위 concern 사이는 packages/contracts로만 부르고,
// 반응기 조립은 아래 모듈을 직접 부른다(apps/worker/problems/test-runner.ts).
export {
  verifiedCandidate,
  verifiedClosure,
  type ClosureEvidence,
  type ConclusionBasis,
} from "./model.ts";
export { handleCloseProblemVerified, closeProblemVerifiedCommand } from "./commands.ts";
export {
  CLOSING_EVENT_TYPES,
  CLOSING_SUBSCRIBER,
  type ClosingEvent,
  type ClosingReactionPorts,
  closingReactionKey,
  reactClosing,
} from "./work.ts";
export {
  createClosingPorts,
  type ClosingClientOptions,
} from "./adapters/core-client.ts";
