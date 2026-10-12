export {
  allSlotSockets,
  createSocketDirectory,
  slotSockets,
  SOCKET_SLOTS,
} from "./socket-dir.ts";
export type { SocketDirDeps, SocketDirectory } from "./socket-dir.ts";
export { sameChild } from "./identity.ts";
export type { ChildIdentity } from "./identity.ts";
export { appArgv, appEnv, flagsAccepted } from "./spawn.ts";
export type { AppEnvironment, AppLaunch } from "./spawn.ts";
export { unexpected } from "./terminate.ts";
export type { StopReason, Termination } from "./terminate.ts";
