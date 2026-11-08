export * from "./values.ts";
export * from "./artifact.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./project-search.ts";

import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";

import { PROJECT_API_ROUTES } from "./project-api.ts";

export const ROUTES = [
  ...PROJECT_API_ROUTES,
  ...PROJECT_SEARCH_ROUTES,
] as const;
