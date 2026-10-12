// allowlist의 이름을 contract route 원본으로 되돌린다. schema 검사는 이 원본으로 한다.
import { ALL_ROUTES } from "../../../../protocol/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";

const BY_NAME = new Map<string, Route>();
for (const route of ALL_ROUTES) {
  BY_NAME.set(
    `${route.kind}:${route.resource}/${route.method}`,
    route as Route,
  );
}

export function routeByName(name: string): Route | undefined {
  return BY_NAME.get(name);
}
