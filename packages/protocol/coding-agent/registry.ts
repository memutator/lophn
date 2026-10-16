import { CONNECTION_EVENTS, CONNECTION_ROUTES } from "./connections.ts";
import { CODING_ROUTES } from "./cli-commands.ts";
import { REPAIR_CONTEXT_ROUTES } from "./repair-context.ts";
import { SESSION_ROUTES } from "./sessions.ts";
import { TICKET_CLAIM_EVENTS } from "./ticket-claims.ts";
import { TICKET_OPEN_EVENTS } from "./ticket-routes.ts";
import { TICKET_ROUTES } from "./ticket/mod.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [
  ...CONNECTION_ROUTES,
  ...SESSION_ROUTES,
  ...TICKET_ROUTES,
  ...REPAIR_CONTEXT_ROUTES,
  ...CODING_ROUTES,
] as const;

export const EVENTS = [
  ...CONNECTION_EVENTS,
  ...TICKET_OPEN_EVENTS,
  ...TICKET_CLAIM_EVENTS,
] as const;
