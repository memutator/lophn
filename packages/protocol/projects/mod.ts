export * from "./values.ts";
export * from "./projects.ts";
export * from "./project-routes.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./project-search.ts";
export * from "./kinds-file.ts";
export * from "./kinds-api.ts";
export * from "./kinds-work.ts";

import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";
import { KIND_ROUTES } from "./kinds-api.ts";

import { projectResolveCwd } from "./project-routes.ts";
import { PROJECT_API_ROUTES } from "./project-api.ts";

export const ROUTES = [
  ...PROJECT_API_ROUTES,
  projectResolveCwd,
  ...PROJECT_SEARCH_ROUTES,
  ...KIND_ROUTES,
] as const;
