import { CODING_ROUTES } from "./cli-commands.ts";

// 지금 있는 route. coding-agent의 다른 route 배열도 여기로 모은다.
export const ROUTES = [
  ...CODING_ROUTES,
] as const;
