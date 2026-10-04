export * from "./values.ts";
export * from "./address.ts";
export * from "./projects.ts";
export * from "./places.ts";
export * from "./versions.ts";
export * from "./document-files.ts";
export * from "./documents.ts";
export * from "./sections.ts";
export * from "./formats.ts";

import { DOCUMENT_EVENTS, DOCUMENT_ROUTES } from "./documents.ts";
import { FORMAT_ROUTES } from "./formats.ts";

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
  ...FORMAT_ROUTES,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
  ...DOCUMENT_EVENTS,
] as const;
