// allowlist의 이름을 contract route 원본으로 되돌린다. schema 검사는 이 원본으로 한다.
import {
  ASSIGNMENT_ROUTES,
  SHARE_REQUEST_ROUTES,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import { ALL_ROUTES } from "../../../../protocol/mod.ts";
import {
  devicesList,
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  pairingStart,
} from "../../../../protocol/remote/routes.ts";
import type { Route } from "../../../../protocol/base/mod.ts";

// approvals와 remote의 route는 core 등록이 내므로 protocol 전체 목록(ALL_ROUTES)에 없다. 사람 화면이 부르는 것만 더한다:
// turn request 결정, 에이전트 할당 읽기·바꾸기, 앱 공유 요청 읽기·결정, 폰 pairing과 기기 관리(Settings › Remote).
export const SHELL_ROUTES: readonly Route[] = [
  ...(ALL_ROUTES as readonly Route[]),
  turnRequestDecide as Route,
  ...(ASSIGNMENT_ROUTES as readonly Route[]),
  ...(SHARE_REQUEST_ROUTES as readonly Route[]),
  pairingStart as Route,
  devicesList as Route,
  devicesRename as Route,
  devicesRevoke as Route,
  devicesSetPrimary as Route,
];

const BY_NAME = new Map<string, Route>();
for (const route of SHELL_ROUTES) {
  BY_NAME.set(`${route.kind}:${route.resource}/${route.method}`, route);
}

export function routeByName(name: string): Route | undefined {
  return BY_NAME.get(name);
}
