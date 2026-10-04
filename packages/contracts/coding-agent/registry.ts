import { CONNECTION_EVENTS, CONNECTION_ROUTES } from "./connections.ts";
import { SESSION_ROUTES } from "./sessions.ts";
import { TICKET_CLAIM_EVENTS, TICKET_CLAIM_ROUTES } from "./ticket-claims.ts";
import { TICKET_OPEN_EVENTS, TICKET_OPEN_ROUTES } from "./ticket-routes.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [
  ...CONNECTION_ROUTES,
  ...SESSION_ROUTES,
  ...TICKET_OPEN_ROUTES,
  ...TICKET_CLAIM_ROUTES,
] as const;

export const EVENTS = [
  ...CONNECTION_EVENTS,
  ...TICKET_OPEN_EVENTS,
  ...TICKET_CLAIM_EVENTS,
] as const;
