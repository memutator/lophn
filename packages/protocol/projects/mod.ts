export * from "./values.ts";
export * from "./artifact.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./identity.ts";
export * from "./identity-api.ts";
export * from "./project-search.ts";
export * from "./project-files.ts";

import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";
import { PROJECT_FILES_ROUTES } from "./project-files.ts";

import { PROJECT_API_ROUTES } from "./project-api.ts";
import { projectIdentityApi } from "./identity-api.ts";

export const ROUTES = [
  ...PROJECT_API_ROUTES,
  projectIdentityApi.recordIdentity,
  ...PROJECT_SEARCH_ROUTES,
  ...PROJECT_FILES_ROUTES,
] as const;
