import { WORKSPACE_ROUTES } from "./workspace.ts";

export {
  WORKSPACE_ROUTES,
  type WorkspaceReadOutput,
  workspaceReadOutputSchema,
} from "./workspace.ts";

// shell은 ledger command·event를 내놓지 않는다. 현재 보기 relay만 core 메모리 route다.
export const ROUTES = WORKSPACE_ROUTES;
