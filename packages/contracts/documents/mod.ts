export * from "./values.ts";
export * from "./address.ts";
export * from "./projects.ts";
export * from "./project-routes.ts";
export * from "./places.ts";
export * from "./versions.ts";
export * from "./document-files.ts";
export * from "./documents.ts";
export * from "./sections.ts";
export * from "./formats.ts";

export * from "./outline.ts";
export * from "./read.ts";
export * from "./search.ts";
export * from "./guides.ts";
export * from "./file-values.ts";
export * from "./files.ts";
export * from "./series.ts";
export * from "./views.ts";

import { DOCUMENT_EVENTS, DOCUMENT_ROUTES } from "./documents.ts";
import { FORMAT_ROUTES } from "./formats.ts";
import { OUTLINE_ROUTES } from "./outline.ts";
import { READ_ROUTES } from "./read.ts";
import { HISTORY_ROUTES } from "./history.ts";
import { SEARCH_ROUTES } from "./search.ts";
import { GUIDE_ROUTES } from "./guides.ts";
import { FILE_EVENTS, FILE_ROUTES } from "./files.ts";
import { SERIES_EVENTS, SERIES_ROUTES } from "./series.ts";
import { VIEW_EVENTS, VIEW_ROUTES } from "./views.ts";

export const DOCUMENT_READ_ROUTES = [
  ...OUTLINE_ROUTES,
  ...READ_ROUTES,
  ...HISTORY_ROUTES,
  ...SEARCH_ROUTES,
  ...GUIDE_ROUTES,
] as const;

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
  ...DOCUMENT_ROUTES,
  ...FORMAT_ROUTES,
  ...DOCUMENT_READ_ROUTES,
  ...FILE_ROUTES,
  ...SERIES_ROUTES,
  ...VIEW_ROUTES,
] as const;

export const EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
  ...DOCUMENT_EVENTS,
  ...FILE_EVENTS,
  ...SERIES_EVENTS,
  ...VIEW_EVENTS,
] as const;
