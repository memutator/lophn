import { machineEnvironment } from "./environment.ts";
import { machineForget } from "./forget.ts";
import { appSyncHeld, appSyncResume } from "./held.ts";
import { appTakeIn } from "./take-in.ts";

export * from "./container.ts";
export * from "./environment.ts";
export * from "./forget.ts";
export * from "./held.ts";
export * from "./layout.ts";
export * from "./limits.ts";
export * from "./records.ts";
export * from "./status.ts";
export * from "./take-in.ts";

// folder wiring(core)이 handler를 붙이는 route. `app.take_in`은 ledger handler 없이 writer 앞에서 처리한다.
export const FOLDER_ROUTES = [
  machineEnvironment,
  machineForget,
  appSyncHeld,
  appSyncResume,
  appTakeIn,
] as const;
