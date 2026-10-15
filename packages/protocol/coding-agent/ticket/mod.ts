// 새 ticket 계약. 옛 `ticket-*.ts`는 cleanup이 지울 때까지 있고, 이 폴더는 deep import한다.
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
