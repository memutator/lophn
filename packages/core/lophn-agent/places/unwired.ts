import { ok } from "../../../base/mod.ts";
import type { EndDeps, OpenDeps } from "./ports.ts";

// wiring이 진짜 port를 놓기 전의 자리다. project와 앱이 없는 것으로 읽혀 session을 열지 못하고,
// 끝날 때의 영향은 아무것도 하지 않는다.
export const UNWIRED_OPEN_DEPS: OpenDeps = {
  projects: { project: () => null, projectByName: () => null },
  apps: { app: () => null, appByName: () => null },
  operators: { operator: () => null, operators: () => [] },
  publish: () => {},
};

export const UNWIRED_END_DEPS: EndDeps = {
  effects: {
    cancelPendingRequests: () => ok(undefined),
    forgetSessionGrants: () => {},
    failReceivedCalls: () => ok(undefined),
  },
  interruptRunningTurns: () => ok(undefined),
  clearInbox: () => {},
  publish: () => {},
};
