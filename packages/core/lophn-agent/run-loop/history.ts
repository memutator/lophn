import type { HistoryPart } from "../prompt-assembly/mod.ts";
import type { CallResult } from "./tool-batch.ts";
import { untrustedSource, wrapUntrusted } from "./untrusted.ts";

// 확정한 tool 결과를 다음 판단의 이력 글로 만든다. loop가 call마다 쓴다. web 결과만 바깥 글로 감싼다.
// 이미지는 text에 base64로 싣지 않고 tool_result_image 조각으로 따로 싣는다.
export function historyResultParts(
  result: Pick<CallResult, "key" | "name" | "status" | "code" | "result">,
): HistoryPart[] {
  const image = imageOf(result.result.content);
  const content = image === null ? result.result.content : Object.fromEntries(
    Object.entries(result.result.content as Record<string, unknown>)
      .filter(([key]) => key !== "image"),
  );
  const text = JSON.stringify({
    status: result.status,
    code: result.code,
    summary: result.result.summary,
    content,
    complete: result.result.complete,
    source: result.result.source,
    continuation: result.result.continuation,
    pending: result.result.pending,
  });
  const source = untrustedSource(result.name);
  const part: HistoryPart = {
    kind: "tool_result",
    id: result.key,
    text: source === null ? text : wrapUntrusted(source, text),
  };
  return image === null
    ? [part]
    : [part, { kind: "tool_result_image", id: result.key, ...image }];
}

function imageOf(
  content: unknown,
): { media_type: string; data_base64: string } | null {
  if (typeof content !== "object" || content === null) return null;
  const image = (content as { image?: unknown }).image;
  if (typeof image !== "object" || image === null) return null;
  const { media_type, data_base64 } = image as Record<string, unknown>;
  return typeof media_type === "string" && typeof data_base64 === "string"
    ? { media_type, data_base64 }
    : null;
}
