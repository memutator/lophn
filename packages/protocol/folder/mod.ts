import { machineEnvironment } from "./environment.ts";
import { machineForget } from "./forget.ts";
import { appSyncHeld, appSyncResume } from "./held.ts";
import { SETTINGS_EXPORT_ROUTES } from "./settings-export.ts";
import { appTakeIn } from "./take-in.ts";
import { TRANSFER_ROUTES } from "./transfers.ts";

export * from "./container.ts";
export * from "./environment.ts";
export * from "./forget.ts";
export * from "./held.ts";
export * from "./layout.ts";
export * from "./limits.ts";
export * from "./records.ts";
export * from "./settings-export.ts";
export * from "./status.ts";
export * from "./take-in.ts";
export * from "./transfers.ts";

// folder wiring(core)이 handler를 붙이는 route. `app.take_in`은 ledger handler 없이 writer 앞에서 처리한다. `carry/*`
// (`remote/carry.ts`의 `CARRY_ROUTES`)도 folder wiring이 붙이지만 약속은 명단에 기대므로 remote에 있다.
export const FOLDER_ROUTES = [
  machineEnvironment,
  machineForget,
  appSyncHeld,
  appSyncResume,
  appTakeIn,
  ...TRANSFER_ROUTES,
  ...SETTINGS_EXPORT_ROUTES,
] as const;
