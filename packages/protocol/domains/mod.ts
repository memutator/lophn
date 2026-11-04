export * from "./values.ts";
export * from "./domains.ts";
export * from "./ports.ts";
export * from "./paths.ts";

import { DOMAIN_ROUTES } from "./domains.ts";

export const ROUTES = [...DOMAIN_ROUTES] as const;
