import type { Result } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  type AgentWorkspace,
  type McpToolServer,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";

// Grants 화면의 MCP tool 목록 요청을 core 대신 읽는다. MCP 연결은 이 프로세스의 몫이라 core가 놓은 요청을
// machine 입구로 하나씩 가져가 서버를 읽고 답한다. 읽는 중 던지면 답하지 않는다: core가 기한이 지나 unavailable로 닫는다.

const MCP_TOOLS_PUMP_IDLE_MS = 250;

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startMcpToolsPump(options: {
  // machine 자격의 core loopback이다.
  call: CoreCall;
  list(
    workspace: AgentWorkspace | null,
    agent: string | null,
  ): Promise<Result<McpToolServer[]>>;
  signal: AbortSignal;
  idleMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const idleMs = options.idleMs ?? MCP_TOOLS_PUMP_IDLE_MS;
  const wait = options.wait ?? abortableWait;
  while (!options.signal.aborted) {
    let worked = false;
    try {
      const taken = await readOf(options.call, mcpToolsRequestTake, {});
      const request = taken.ok ? taken.value.request : null;
      if (request !== null) {
        worked = true;
        const listed = await options.list(request.workspace, request.agent);
        if (listed.ok) {
          await options.call(routePath(mcpToolsRequestDone), {
            id: request.id,
            servers: listed.value,
          });
        }
      }
    } catch {
      // core에 닿지 못했거나 읽다 던졌다. 값을 싣지 않고 다음 차례에 다시 본다.
    }
    if (!worked) await wait(idleMs, options.signal);
  }
}
