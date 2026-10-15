export {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffMs,
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  crashLoop,
  recentExits,
} from "./restart-policy.ts";
export type { UnexpectedExit } from "./restart-policy.ts";
export { attachControlLink, encodeControl, OpError } from "./control-link.ts";
export type {
  ControlHello,
  ControlLink,
  ControlLinkOptions,
  ControlReader,
  OpHandlers,
} from "./control-link.ts";
export { createSupervisor, STOP_GRACE_MS } from "./supervisor.ts";
export type {
  AppChild,
  AppObservation,
  CandidateStart,
  ControlTarget,
  DesiredApp,
  ProbeResult,
  Supervisor,
  SupervisorDeps,
  SupervisorEvent,
} from "./supervisor.ts";
export {
  APPLY_TIMEOUT_MS,
  CALL_RESPONSE_MAX_BYTES,
  CALL_TIMEOUT_MS,
  type CallOutput,
  type ControlReply,
  type ControlRequest,
  type ControlTransport,
  createRelay,
  type Relay,
} from "./relay.ts";
