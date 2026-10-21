import { RUN_ROUTES } from "./runs.ts";

export * from "./runs.ts";

export const ROUTES = [...RUN_ROUTES] as const;
