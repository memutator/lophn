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
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./project-search.ts";
export * from "./context-drafts.ts";
export * from "./context-outlines.ts";

import { CONTEXT_API_EVENTS, CONTEXT_API_ROUTES } from "./context-api.ts";
import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";
import { CONTEXT_OUTLINE_ROUTES } from "./context-outlines.ts";

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
  ...PROJECT_SEARCH_ROUTES,
  ...CONTEXT_OUTLINE_ROUTES,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
  ...CONTEXT_API_EVENTS,
] as const;
