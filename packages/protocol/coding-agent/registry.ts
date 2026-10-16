import { CODING_ROUTES } from "./cli-commands.ts";
import { TICKET_ROUTES } from "./ticket/mod.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [
  ...TICKET_ROUTES,
  ...CODING_ROUTES,
] as const;
