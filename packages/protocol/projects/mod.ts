export * from "./values.ts";
export * from "./projects.ts";
export * from "./project-routes.ts";
export * from "./openable-format.ts";
export * from "./outline-markdown.ts";
export * from "./read-values.ts";
export * from "./context-contract.ts";
export * from "./context-api.ts";
export * from "./context-work.ts";
export * from "./project-folders.ts";
export * from "./project-api.ts";
export * from "./project-search.ts";
export * from "./context-drafts.ts";
export * from "./context-outlines.ts";

import { CONTEXT_API_ROUTES } from "./context-api.ts";
import { PROJECT_SEARCH_ROUTES } from "./project-search.ts";
import { CONTEXT_DRAFT_ROUTES } from "./context-drafts.ts";
import { CONTEXT_OUTLINE_ROUTES } from "./context-outlines.ts";

import { projectResolveCwd } from "./project-routes.ts";
import { PROJECT_API_ROUTES } from "./project-api.ts";

export const ROUTES = [
  ...PROJECT_API_ROUTES,
  projectResolveCwd,
  ...CONTEXT_API_ROUTES,
  ...CONTEXT_DRAFT_ROUTES,
  ...PROJECT_SEARCH_ROUTES,
  ...CONTEXT_OUTLINE_ROUTES,
] as const;

