export * from "./values.ts";
export * from "./address.ts";
export * from "./projects.ts";
export * from "./places.ts";
export * from "./versions.ts";
export * from "./documents.ts";

import { DOCUMENT_EVENTS, DOCUMENT_ROUTES } from "./documents.ts";

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
  ...DOCUMENT_ROUTES,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
] as const;
