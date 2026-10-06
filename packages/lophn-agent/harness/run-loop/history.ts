import type { HistoryPart } from "../prompt-assemble/mod.ts";
import { wireData } from "../safety/mod.ts";
import type { CallResult } from "./tool-batch.ts";

// 확정한 tool 결과를 다음 판단의 이력 글로 만든다. loop가 call마다 쓰고, 복구가 ledger에서 이력을
// 다시 만들 때도 같은 모양을 쓴다(lophn-agent/harness/waiting-and-recovery R8).
export async function historyResultPart(
  collectedAt: string,
  result: Pick<CallResult, "key" | "name" | "status" | "code" | "result">,
): Promise<HistoryPart> {
  const wired = await wireData(
    JSON.stringify({
      status: result.status,
      code: result.code,
      summary: result.result.summary,
      content: result.result.content,
      complete: result.result.complete,
      source: result.result.source,
      continuation: result.result.continuation,
      pending: result.result.pending,
    }),
    {
      kind: "tool_result",
      address: result.name,
      collected_at: collectedAt,
    },
  );
  return { kind: "tool_result", id: result.key, text: wired.wrapped };
}
