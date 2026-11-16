// The guest runtime: a user app's phone screen in its own React Native runtime inside the phone app (Android).
export { ensureBase } from "./files.ts";
export { guestHostInfo } from "./host-info.ts";
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
