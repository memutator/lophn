// allowlist의 이름을 contract route 원본으로 되돌린다. schema 검사는 이 원본으로 한다.
import {
  ASSIGNMENT_ROUTES,
  PERMISSIONS_VIEW_ROUTES,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";
import { ALL_ROUTES } from "../../../../protocol/mod.ts";
import {
  devicesList,
  devicesSetPrimary,
  machinesCall,
  machinesList,
  machinesWatch,
  rosterInvite,
  rosterJoin,
  rosterList,
  rosterRemove,
  rosterRename,
  rosterSetTerminalInput,
} from "../../../../protocol/remote/routes.ts";

// approvals와 remote의 route는 core 등록이 내므로 protocol 전체 목록(ALL_ROUTES)에 없다. 사람 화면이 부르는 것만 더한다:
// turn request 결정, 에이전트 할당 읽기·바꾸기, 앱 공유 요청 읽기·결정, 내 기기 명단과 기기 관리(Settings › Remote), 다른 기계를
// 보는 `machines/*`(renderer는 `machines/list`만 읽고 나머지는 shell main만 부른다).
export const SHELL_ROUTES: readonly Route[] = [
  ...(ALL_ROUTES as readonly Route[]),
  turnRequestDecide as Route,
  ...(ASSIGNMENT_ROUTES as readonly Route[]),
  ...(PERMISSIONS_VIEW_ROUTES as readonly Route[]),
  devicesList as Route,
  devicesSetPrimary as Route,
  rosterList as Route,
  rosterInvite as Route,
  rosterJoin as Route,
  rosterRemove as Route,
  rosterSetTerminalInput as Route,
  rosterRename as Route,
  machinesList as Route,
  machinesCall as Route,
  machinesWatch as Route,
];

const BY_NAME = new Map<string, Route>();
for (const route of SHELL_ROUTES) {
  BY_NAME.set(`${route.kind}:${route.resource}/${route.method}`, route);
}

export function routeByName(name: string): Route | undefined {
  return BY_NAME.get(name);
}
