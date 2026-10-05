// renderer가 부를 수 있는 것은 contract schema의 read·command와, worker에서 조립하는
// 문서 읽기 몇 개뿐이다. credential 발급·daemon 종료는 route가 아니라 pipe 메시지라 이
// 목록에 없다.
import { ALL_ROUTES } from "../../../../../packages/contracts/mod.ts";

// 문서 읽기 화면(shell/editor)이 쓰는 worker route. outline과 본문은 core read queue를
// 막지 않으려고 worker에서 조립할 뿐 읽기다. 쓰기·준비·파일 통로 worker는 넣지 않는다.
export const READING_WORKER_ROUTES: readonly string[] = [
  "worker:outline/document",
  "worker:documents/read",
];

/** allowlist는 이름만 기억한다. schema 검사는 client가 route 원본으로 한다. */
const ALLOWED = new Set<string>();
for (const route of ALL_ROUTES) {
  const name = `${route.kind}:${route.resource}/${route.method}`;
  if (route.kind === "worker" && READING_WORKER_ROUTES.includes(name)) {
    ALLOWED.add(name);
    continue;
  }
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
