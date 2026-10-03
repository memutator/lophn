import { CONNECTION_EVENTS, CONNECTION_ROUTES } from "./connections.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [...CONNECTION_ROUTES] as const;

export const EVENTS = [...CONNECTION_EVENTS] as const;
