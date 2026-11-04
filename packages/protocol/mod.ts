// 최상위 contracts를 다시 내보내고 route·event 목록을 모은다. 정의는 각 최상위에 둔다.

export * as apps from "./apps/mod.ts";
export * as problems from "./problems/mod.ts";
export * as codingAgent from "./coding-agent/mod.ts";
export * as lophnAgent from "./lophn-agent/mod.ts";
export * as documents from "./projects/mod.ts";
export * as runs from "./runs/mod.ts";
export * as workflows from "./workflows/mod.ts";
export * as jobs from "./jobs/mod.ts";
export * as shell from "./shell/mod.ts";

import { ROUTES as appsRoutes } from "./apps/mod.ts";
import { ROUTES as lophnAgentRoutes } from "./lophn-agent/mod.ts";
import { ROUTES as codingAgentRoutes } from "./coding-agent/mod.ts";
import { ROUTES as documentsRoutes } from "./projects/mod.ts";
import { ROUTES as runsRoutes } from "./runs/mod.ts";
import { ROUTES as workflowsRoutes } from "./workflows/mod.ts";
import { ROUTES as jobsRoutes } from "./jobs/mod.ts";
import { ROUTES as platformRoutes } from "./registry.ts";
import { ROUTES as shellRoutes } from "./shell/mod.ts";

export const ALL_ROUTES = [
  ...platformRoutes,
  ...shellRoutes,
  ...documentsRoutes,
  ...runsRoutes,
  ...workflowsRoutes,
  ...jobsRoutes,
  ...codingAgentRoutes,
  ...appsRoutes,
  ...lophnAgentRoutes,
];
