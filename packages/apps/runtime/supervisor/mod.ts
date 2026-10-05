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
export { attachControlLink, encodeControl } from "./control-link.ts";
export type {
  ControlLink,
  ControlMessage,
  ControlReader,
} from "./control-link.ts";
export { createSupervisor, STOP_GRACE_MS } from "./supervisor.ts";
export type {
  AppChild,
  AppObservation,
  DesiredApp,
  ProbeResult,
  Supervisor,
  SupervisorDeps,
} from "./supervisor.ts";
