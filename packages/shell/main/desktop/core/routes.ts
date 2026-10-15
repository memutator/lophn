// allowlist의 이름을 contract route 원본으로 되돌린다. schema 검사는 이 원본으로 한다.
import {
  AGENT_GRANT_ROUTES,
  APPROVAL_DECISION_ROUTES,
  APPROVAL_ROUTES,
} from "../../../../protocol/approvals/mod.ts";
import { ALL_ROUTES } from "../../../../protocol/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";

// approvals의 route는 core 등록이 내므로 protocol 전체 목록(ALL_ROUTES)에 없다. 사람 화면이 부르는 것만 더한다:
// 요청 읽기와 사람 결정, 에이전트 허락 읽기·바꾸기. 요청을 만들고 적용하는 command는 사람 화면이 부르지 않는다.
export const SHELL_ROUTES: readonly Route[] = [
  ...ALL_ROUTES as readonly Route[],
  ...APPROVAL_ROUTES.filter((route) =>
    route.kind === "read"
  ) as readonly Route[],
  ...APPROVAL_DECISION_ROUTES as readonly Route[],
  ...AGENT_GRANT_ROUTES as readonly Route[],
];

const BY_NAME = new Map<string, Route>();
for (const route of SHELL_ROUTES) {
  BY_NAME.set(`${route.kind}:${route.resource}/${route.method}`, route);
}

export function routeByName(name: string): Route | undefined {
  return BY_NAME.get(name);
}
