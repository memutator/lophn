// 최상위 contracts를 다시 내보내고 route·event 목록을 모은다. 정의는 각 최상위에 둔다.

export * as apps from "./apps/mod.ts";
export * as problems from "./problems/mod.ts";
export * as codingAgent from "./coding-agent/mod.ts";
export * as lophnAgent from "./lophn-agent/mod.ts";
export * as documents from "./projects/mod.ts";
export * as platform from "./server/mod.ts";
export * as shell from "./shell/mod.ts";

import { EVENTS as appsEvents, ROUTES as appsRoutes } from "./apps/mod.ts";
import {
  EVENTS as lophnAgentEvents,
  ROUTES as lophnAgentRoutes,
} from "./lophn-agent/mod.ts";
import {
  EVENTS as codingAgentEvents,
  ROUTES as codingAgentRoutes,
} from "./coding-agent/mod.ts";
import {
  EVENTS as documentsEvents,
  ROUTES as documentsRoutes,
} from "./projects/mod.ts";
import {
  EVENTS as platformEvents,
  ROUTES as platformRoutes,
} from "./server/mod.ts";
import { EVENTS as shellEvents, ROUTES as shellRoutes } from "./shell/mod.ts";
import {
  EVENTS as problemsEvents,
  ROUTES as problemsRoutes,
} from "./problems/mod.ts";

export const ALL_ROUTES = [
  ...platformRoutes,
  ...shellRoutes,
  ...documentsRoutes,
  ...codingAgentRoutes,
  ...appsRoutes,
  ...problemsRoutes,
  ...lophnAgentRoutes,
];

export const ALL_EVENTS = [
  ...platformEvents,
  ...shellEvents,
  ...documentsEvents,
  ...codingAgentEvents,
  ...appsEvents,
  ...problemsEvents,
  ...lophnAgentEvents,
];
