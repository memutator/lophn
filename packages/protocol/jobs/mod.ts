import { JOB_ROUTES } from "./jobs.ts";

export * from "./values.ts";
export * from "./jobs.ts";

export const ROUTES = [...JOB_ROUTES] as const;
