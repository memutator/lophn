import { advanceSubscriberCursor, eventsList } from "./events.ts";
import {
  commandsResult,
  identityCurrent,
  platformHealth,
  platformStatus,
} from "./platform-routes.ts";
import { BLOB_ROUTES } from "./blob.ts";
import { SETTINGS_EVENTS, SETTINGS_ROUTES } from "./settings.ts";

// 지금 있는 route. 다른 파일의 route 배열(SETTINGS_ROUTES 등)도 여기로 모은다.
export const ROUTES = [
  platformStatus,
  platformHealth,
  identityCurrent,
  commandsResult,
  eventsList,
  advanceSubscriberCursor,
  ...SETTINGS_ROUTES,
  ...BLOB_ROUTES,
] as const;

// 지금 있는 event. platform 소유 event는 settings에서 시작한다.
export const EVENTS = [...SETTINGS_EVENTS] as const;
