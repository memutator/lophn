import type { Result } from "../../../base/mod.ts";
import { findInvocation, recordedResult } from "../tools/mod.ts";
import type { AppTool } from "../tools/mod.ts";
import type { ToolLookup } from "./recovery-work.ts";

// 결과를 모르는 앱 command의 저장된 결과 조회다(waiting-and-recovery R8–R10). 재시작 뒤 복구가 쓰고, 이
// 시점에는 run의 agent 자격이 없어 machine이 읽는 apps invocations 기록만 본다. 이 ToolCall이 앱에 남긴
// invocation(호출자가 인증된 run·ToolCall)이 종료 상태(succeeded·failed)이면 그 결과로 닫고, 기록이 없거나
// 아직 끝나지 않았거나 상태를 모르면 null이라 불명확으로 남는다. 찾지 못한 것을 성공·미실행으로
// 추측하지 않고 같은 호출을 다시 보내지 않는다.
export function createAppToolLookups(
  tools: readonly AppTool[],
  read: (contract: string, input: unknown) => Promise<Result<unknown>>,
): ReadonlyMap<string, ToolLookup> {
  const lookups = new Map<string, ToolLookup>();
  for (const tool of tools) {
    if (tool.effect === "read") continue;
    lookups.set(tool.definition.name, async (call) => {
      const found = await findInvocation(read, tool.app, call.tool_call);
      if (!found.ok || found.value === null) return null;
      const recorded = recordedResult(tool, found.value);
      if (recorded === null) return null;
      return {
        outcome: {
          kind: recorded.kind === "succeeded" ? "success" : "failure",
          code: recorded.kind === "succeeded" ? "ok" : "failed",
        },
        result: recorded.result,
      };
    });
  }
  return lookups;
}
