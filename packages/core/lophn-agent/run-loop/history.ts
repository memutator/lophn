import type { HistoryPart } from "../prompt-assembly/mod.ts";
import type { CallResult } from "./tool-batch.ts";
import { untrustedSource, wrapUntrusted } from "./untrusted.ts";

// 확정한 tool 결과를 다음 판단의 이력 글로 만든다. loop가 call마다 쓴다. web 결과만 바깥 글로 감싼다.
export function historyResultPart(
  result: Pick<CallResult, "key" | "name" | "status" | "code" | "result">,
): HistoryPart {
  const text = JSON.stringify({
    status: result.status,
    code: result.code,
    summary: result.result.summary,
    content: result.result.content,
    complete: result.result.complete,
    source: result.result.source,
    continuation: result.result.continuation,
    pending: result.result.pending,
  });
  const source = untrustedSource(result.name);
  return {
    kind: "tool_result",
    id: result.key,
    text: source === null ? text : wrapUntrusted(source, text),
  };
}
