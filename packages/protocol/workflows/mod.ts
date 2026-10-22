import { WORKFLOW_COMMAND_ROUTES } from "./commands.ts";
import { WORKFLOW_ROUTES } from "./routes.ts";

export * from "./paths.ts";
export * from "./values.ts";
export * from "./declaration.ts";
export * from "./instances.ts";
export * from "./routes.ts";
export * from "./commands.ts";

export const ROUTES = [...WORKFLOW_ROUTES, ...WORKFLOW_COMMAND_ROUTES] as const;
