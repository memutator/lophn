export * from "./values.ts";
export * from "./address.ts";
export * from "./projects.ts";
export * from "./places.ts";

import {
  projectArchive,
  projectArchived,
  projectCreate,
  projectCreated,
  projectGet,
  projectList,
  projectPreviewTracking,
  projectResolve,
  projectSetTracking,
  projectTrackingChanged,
  projectUnarchive,
  projectUnarchived,
  projectUpdate,
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
  projectPreviewTracking,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
] as const;
