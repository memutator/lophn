export * from "./values.ts";
export * from "./artifact.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./identity.ts";
export * from "./identity-api.ts";
export * from "./clone-api.ts";
export * from "./project-search.ts";
export * from "./project-files.ts";
export * from "./artifact-api.ts";

import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";
import { PROJECT_FILES_ROUTES } from "./project-files.ts";
import {
  ARTIFACT_FILE_ROUTES,
  ARTIFACT_MEMORY_ROUTES,
} from "./artifact-api.ts";

import { PROJECT_API_ROUTES } from "./project-api.ts";
import {
  PROJECT_IDENTITY_MEMORY_ROUTES,
  projectIdentityApi,
} from "./identity-api.ts";
import { PROJECT_CLONE_ROUTES } from "./clone-api.ts";
import { PROJECT_ADD_ROUTES } from "./add-api.ts";

export const ROUTES = [
  ...PROJECT_API_ROUTES,
  projectIdentityApi.recordIdentity,
  projectIdentityApi.linkIdentity,
  projectIdentityApi.renewIdentity,
  ...PROJECT_CLONE_ROUTES,
  ...PROJECT_ADD_ROUTES,
  ...PROJECT_IDENTITY_MEMORY_ROUTES,
  ...PROJECT_SEARCH_ROUTES,
  ...PROJECT_FILES_ROUTES,
  ...ARTIFACT_MEMORY_ROUTES,
  ...ARTIFACT_FILE_ROUTES,
] as const;
