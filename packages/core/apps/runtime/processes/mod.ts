export type { ChildIdentity } from "./identity.ts";
export { sameChild } from "./identity.ts";
export {
  createSocketDirectory,
  SOCKET_SLOTS,
  slotSockets,
} from "./socket-dir.ts";
export type { AppCommand, AppEnvironment, AppLaunch } from "./spawn.ts";
export { appCommand, appEnv } from "./spawn.ts";
export type { StopReason } from "./terminate.ts";
