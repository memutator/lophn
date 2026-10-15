export * from "./values.ts";
export * from "./projects.ts";
export * from "./project-routes.ts";
export * from "./places.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./read-values.ts";
export * from "./guides.ts";
export * from "./context-contract.ts";
export * from "./context-api.ts";
export * from "./context-work.ts";

import { CONTEXT_API_EVENTS, CONTEXT_API_ROUTES } from "./context-api.ts";

import {
  projectArchive,
  projectCreate,
  projectGet,
  projectList,
  projectPreviewTracking,
  projectResolve,
  projectResolveCwd,
  projectSetTracking,
  projectTrackingRoots,
  projectUnarchive,
  projectUpdate,
} from "./project-routes.ts";
import {
  projectArchived,
  projectCreated,
  projectTrackingChanged,
  projectUnarchived,
  projectUpdated,
} from "./projects.ts";

export const ROUTES = [
  projectCreate,
  projectUpdate,
  projectSetTracking,
  projectArchive,
  projectUnarchive,
  projectList,
  projectGet,
  projectResolve,
  projectResolveCwd,
  projectTrackingRoots,
  projectPreviewTracking,
  ...CONTEXT_API_ROUTES,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
  ...CONTEXT_API_EVENTS,
] as const;
