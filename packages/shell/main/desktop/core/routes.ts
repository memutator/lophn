// allowlist의 이름을 contract route 원본으로 되돌린다. schema 검사는 이 원본으로 한다.
import {
  AGENT_ASSIGNMENT_ROUTES,
  AGENT_GRANT_ROUTES,
  APPROVAL_DECISION_ROUTES,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import { ALL_ROUTES } from "../../../../protocol/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";

// approvals의 route는 core 등록이 내므로 protocol 전체 목록(ALL_ROUTES)에 없다. 사람 화면이 부르는 것만 더한다:
// turn request 결정, 사람 결정, 에이전트 허락·할당 읽기·바꾸기.
export const SHELL_ROUTES: readonly Route[] = [
  ...ALL_ROUTES as readonly Route[],
  ...APPROVAL_DECISION_ROUTES as readonly Route[],
  turnRequestDecide as Route,
  ...AGENT_GRANT_ROUTES as readonly Route[],
  ...AGENT_ASSIGNMENT_ROUTES as readonly Route[],
];

const BY_NAME = new Map<string, Route>();
for (const route of SHELL_ROUTES) {
  BY_NAME.set(`${route.kind}:${route.resource}/${route.method}`, route);
}

export function routeByName(name: string): Route | undefined {
  return BY_NAME.get(name);
}
