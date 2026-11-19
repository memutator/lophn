// The guest runtime: a user app's phone screen in its own React Native runtime inside the phone app (Android).
export type { GuestAppDbProp } from "./app-db.ts";
export {
  createUpdateCoalescer,
  GUEST_UPDATE_COALESCE_MS,
  type UpdateCoalescer,
} from "./coalesce.ts";
export { ensureBase } from "./files.ts";
export { guestHostInfo } from "./host-info.ts";
export {
  GUEST_BLOCKED_RN_EXPORTS,
  GUEST_BLOCKED_VIEWS,
  GUEST_MODULES,
  guestReactNative,
} from "./modules.ts";
export {
  GUEST_START_LIMIT_MS,
  GuestScreen,
  type GuestScreenProps,
} from "./screen.tsx";
export type {
  AppEvent,
  CallOutcome,
  GuestCall,
  GuestFailure,
  GuestState,
} from "./session.ts";
