// renderer가 부를 수 있는 것은 contract schema의 read·command뿐이다.
// credential 발급·daemon 종료는 route가 아니라 pipe 메시지라 이 목록에 없다.
import { ALL_ROUTES } from "../../../../../packages/contracts/mod.ts";

/** allowlist는 이름만 기억한다. schema 검사는 client가 route 원본으로 한다. */
const ALLOWED = new Set<string>();
for (const route of ALL_ROUTES) {
  if (route.kind !== "read" && route.kind !== "command") continue;
  if (route.resource === "identity" && route.method === "issue") continue;
  ALLOWED.add(`${route.kind}:${route.resource}/${route.method}`);
}

/** 고정 연결 intent는 연결 화면만 검증해서 부른다(desktop#R19). */
export const CONNECTION_INTENT = "command:coding_agent_connections/create";

export function lookupCall(
  kind: string,
  resource: string,
  method: string,
): string | undefined {
  const key = `${kind}:${resource}/${method}`;
  return ALLOWED.has(key) ? key : undefined;
}

export function isAllowed(
  kind: string,
  resource: string,
  method: string,
): boolean {
  return ALLOWED.has(`${kind}:${resource}/${method}`);
}
