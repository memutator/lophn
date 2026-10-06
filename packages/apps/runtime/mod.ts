// 앱 프로세스 안 entrypoint 코드(startRuntime·startDirectServer 등)는 core가 import하는 이 경계에 두지 않는다
// (core module graph, platform/responsiveness#R1). 시험은 `./testing/mod.ts`로 부른다.
export { createSupervisor } from "./supervisor/mod.ts";
export type { DesiredApp, Supervisor } from "./supervisor/mod.ts";
export type { CoreLink, RuntimeRecord } from "./core-link.ts";
export { type CoreSigner, createCoreSigner } from "./signing.ts";
export {
  type PreviewLaunch,
  previewLaunchSchema,
  previewNonceSchema,
  SUPERVISOR_OPS,
} from "./control-protocol.ts";
export type { ObservationWire } from "./control-protocol.ts";
export type { AppChild } from "./supervisor/mod.ts";
export type { AppEnvironment, ChildIdentity } from "./processes/mod.ts";
export { appArgv, appEnv, flagsAccepted } from "./processes/mod.ts";
export { SOCKET_SLOTS } from "./processes/mod.ts";
export type {
  AppFacts,
  ConnectFacts,
  ProcessObservation,
  ProcessQuery,
  ProcessSource,
} from "./connect.ts";
