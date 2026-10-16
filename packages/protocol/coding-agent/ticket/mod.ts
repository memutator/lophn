// ticket 계약. 이 폴더는 deep import한다.
import { TICKET_CLAIM_ROUTES } from "./claims.ts";
import { TICKET_ROUTE_LIST } from "./routes.ts";

export * from "./values.ts";
export * from "./routes.ts";
export * from "./claims.ts";
export * from "./ports.ts";

export const TICKET_ROUTES = [
  ...TICKET_ROUTE_LIST,
  ...TICKET_CLAIM_ROUTES,
] as const;
