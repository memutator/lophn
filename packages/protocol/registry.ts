import { advanceSubscriberCursor, eventsList } from "./events/events.ts";
import { sessionSnapshotsList } from "./events/snapshot.ts";
import {
  commandsResult,
  identityCurrent,
  platformHealth,
  platformStatus,
} from "./server/routes.ts";
import { BLOB_ROUTES } from "./storage/blob.ts";
import { DIAGNOSTIC_ROUTES } from "./diagnostics/diagnostics.ts";
import { SETTINGS_EVENTS, SETTINGS_ROUTES } from "./config/settings.ts";
import { SECRET_EVENTS, SECRET_ROUTES } from "./secrets/secrets.ts";
import { SETTINGS_FILE_ROUTES } from "./config/file.ts";
import { SECRET_FILE_ROUTES } from "./secrets/secret-file.ts";
import { DIAGNOSTIC_STATUS_ROUTES } from "./diagnostics/diagnostics.ts";

// 지금 있는 route. 다른 파일의 route 배열(SETTINGS_ROUTES 등)도 여기로 모은다.
// approvals의 route는 core 등록(`core/approvals/registration.ts`)이 낸다. 여기 두면 겹친다.
export const ROUTES = [
  platformStatus,
  platformHealth,
  identityCurrent,
  commandsResult,
  eventsList,
  advanceSubscriberCursor,
  sessionSnapshotsList,
  ...SETTINGS_ROUTES,
  ...BLOB_ROUTES,
  ...DIAGNOSTIC_ROUTES,
  ...SECRET_ROUTES,
  ...SETTINGS_FILE_ROUTES,
  ...SECRET_FILE_ROUTES,
  ...DIAGNOSTIC_STATUS_ROUTES,
] as const;

// 지금 있는 event. platform 소유 event는 settings에서 시작한다.
export const EVENTS = [
  ...SETTINGS_EVENTS,
  ...SECRET_EVENTS,
] as const;
