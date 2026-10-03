// 최상위 contracts를 다시 내보내고 route·event 목록을 모은다. 정의는 각 최상위에 둔다.

export * as platform from "./platform/mod.ts";
export * as shell from "./shell/mod.ts";

import {
  EVENTS as platformEvents,
  ROUTES as platformRoutes,
} from "./platform/mod.ts";
import { EVENTS as shellEvents, ROUTES as shellRoutes } from "./shell/mod.ts";

export const ALL_ROUTES = [...platformRoutes, ...shellRoutes];

export const ALL_EVENTS = [...platformEvents, ...shellEvents];
