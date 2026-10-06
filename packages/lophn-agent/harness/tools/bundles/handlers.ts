import type { ToolHandler } from "../work.ts";
import { type AgentToolPorts, createAgentToolHandlers } from "./agent.ts";
import { createDocumentToolHandlers } from "./document.ts";
import { createFormatToolHandlers } from "./format.ts";
import { createGuideToolHandlers } from "./guide.ts";
import { createReadLog } from "./read-log.ts";
import { createVisualToolHandlers } from "./visual.ts";

// 내장 묶음 전부의 handler다. 이름이 겹치지 않는다. 묶음마다 필요한 통로는 `call` 하나로 같고
// agent 일 묶음만 run 사실과 ID를 더 쓴다. 어느 handler도 blob을 준비하거나 hash를 만들지 않는다.
export function createBuiltinToolHandlers(
  ports: AgentToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const merged = new Map<string, ToolHandler>();
  // 문서 묶음이 기록한 읽은 판을 시각 묶음이 출처 검증에 읽는다.
  const reads = createReadLog();
  for (
    const group of [
      createDocumentToolHandlers(ports, reads),
      createFormatToolHandlers(ports),
      createVisualToolHandlers(ports, reads),
      createAgentToolHandlers(ports),
      createGuideToolHandlers(ports),
    ]
  ) {
    for (const [name, handler] of group) {
      if (merged.has(name)) throw new Error(`duplicate tool handler ${name}`);
      merged.set(name, handler);
    }
  }
  return merged;
}
