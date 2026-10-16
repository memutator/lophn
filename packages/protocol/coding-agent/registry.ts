import { CONNECTION_EVENTS, CONNECTION_ROUTES } from "./connections.ts";
import { CODING_ROUTES } from "./cli-commands.ts";
import { TICKET_ROUTES } from "./ticket/mod.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [
  ...CONNECTION_ROUTES,
  ...TICKET_ROUTES,
  ...CODING_ROUTES,
] as const;

export const EVENTS = [...CONNECTION_EVENTS] as const;
