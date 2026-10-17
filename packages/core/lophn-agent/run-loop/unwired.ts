import { err } from "../../../base/mod.ts";
import type { ToolPorts } from "./prepare.ts";

// 조립이 진짜 연결을 끼우기 전의 `ToolContext` 바깥 연결이다. 닫힌 채 실패해서 Gate가 필요한 tool, 다른 agent를
// 부르는 tool, 질문, 폴더를 쓰는 tool은 돌지 않는다. 묻는 대신 허락하는 일은 없다.
const unavailable = () =>
  err({ code: "unavailable" as const, message: "this port is not wired" });

export const UNWIRED_TOOL_PORTS: ToolPorts = {
  gate: { check: () => Promise.resolve(unavailable()) },
  router: {
    send: () => Promise.resolve(unavailable()),
    reply: () => Promise.resolve(unavailable()),
    cancel: () => Promise.resolve(unavailable()),
    sendable: () => Promise.resolve(unavailable()),
  },
  questions: { ask: () => Promise.resolve(unavailable()) },
  scope: { read: [], write: [] },
  skills: { read: () => Promise.resolve(unavailable()) },
  fetch: (...args) => fetch(...args),
};
