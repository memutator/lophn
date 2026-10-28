import { err, ok } from "../../../base/mod.ts";
import type { EndDeps, PlaceDeps } from "./ports.ts";

// wiring이 진짜 directory를 놓기 전의 값이다. project와 앱이 없는 것으로 읽혀 session을 열지 못한다.
export const UNWIRED_PLACE_DEPS: PlaceDeps = {
  projects: { project: () => null, projectByName: () => null },
  apps: { app: () => null, appByName: () => null },
  agents: { agent: () => null, agents: () => [] },
  names: {
    nameOf: () => "",
    resolveAddress: () =>
      err({ code: "not_found", message: "agent not found" }),
  },
};

// 끝날 때의 영향을 아무것도 하지 않는 값이다. 시험이 쓴다.
export const UNWIRED_END_DEPS: EndDeps = {
  effects: {
    cancelPendingRequests: () => ok(undefined),
    failReceivedCalls: () => ok(undefined),
  },
  interruptRunningTurns: () => ok(undefined),
  clearInbox: () => {},
  publish: () => {},
};
