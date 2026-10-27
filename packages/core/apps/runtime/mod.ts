// 앱 프로세스 안 entrypoint 코드(startRuntime·startDirectServer 등)는 core가 import하는 이 경계에 두지 않는다
// (core module graph).

export type { ConnectFacts } from "./connect.ts";
export type { ObservationWire } from "./control-protocol.ts";
export {
  type PreviewLaunch,
  previewLaunchSchema,
  SUPERVISOR_OPS,
} from "./control-protocol.ts";
export type { CoreLink, RuntimeRecord } from "./core-link.ts";
export type {
  AppCommand,
  AppEnvironment,
  ChildIdentity,
} from "./processes/mod.ts";
export { appCommand, appEnv, SOCKET_SLOTS } from "./processes/mod.ts";
export type { AppChild, DesiredApp, Supervisor } from "./supervisor/mod.ts";
export { createSupervisor } from "./supervisor/mod.ts";
