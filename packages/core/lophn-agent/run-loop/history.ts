import {
  type HistoryMessage,
  type HistoryPart,
  wrapUntrusted,
} from "../prompt-assembly/mod.ts";
import type { CallResult } from "./tool-batch.ts";
import { untrustedSource } from "./untrusted.ts";

// 확정한 tool 결과를 다음 판단의 이력 글로 만든다. loop가 call마다 쓴다. web 결과만 바깥 글로 감싼다.
// 이미지는 text에 base64로 싣지 않고 tool_result_image 조각으로 따로 싣는다. tool.load가 불러온 이름은
// tool_result_reference 조각으로 따로 싣는다.
// 오래된 이미지는 omitOldImages가 뺀다. 요청 body 전체를 blob으로 저장하므로 이미지가 쌓이면 상한을 넘는다.
export function historyResultParts(
  result: Pick<CallResult, "key" | "name" | "status" | "code" | "result">,
): HistoryPart[] {
  const image = imageOf(result.result.content);
  const references = referencesOf(result.result.content);
  const content = image === null && references === null
    ? result.result.content
    : Object.fromEntries(
      Object.entries(result.result.content as Record<string, unknown>)
        .filter(([key]) => key !== "image" && key !== "tool_reference"),
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
  if (references !== null) {
    return [part, {
      kind: "tool_result_reference",
      id: result.key,
      names: references,
    }];
  }
  return image === null
    ? [part]
    : [part, { kind: "tool_result_image", id: result.key, ...image }];
}

function referencesOf(content: unknown): string[] | null {
  if (typeof content !== "object" || content === null) return null;
  const names = (content as { tool_reference?: unknown }).tool_reference;
  return Array.isArray(names) && names.every((n) => typeof n === "string")
    ? names
    : null;
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

// 최대 크기 이미지 둘이 blob 상한(16 MiB) 안에 들어가는 개수다.
export const KEEP_IMAGES = 2;

// 최신 keep개만 남기고 오래된 이미지 조각을 뺀다. 짝 tool_result 글 끝에 표시를 붙인다.
// 입력은 바꾸지 않는다.
export function omitOldImages(
  history: readonly HistoryMessage[],
  keep: number,
): HistoryMessage[] {
  const images = history.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.kind === "tool_result_image" ? [part] : []
    )
  );
  const old = new Set(images.slice(0, Math.max(0, images.length - keep)));
  if (old.size === 0) return [...history];
  const ids = new Set([...old].map((part) => part.id));
  return history.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): HistoryPart[] => {
      if (part.kind === "tool_result_image") return old.has(part) ? [] : [part];
      if (part.kind === "tool_result" && ids.has(part.id)) {
        return [{ ...part, text: `${part.text}\n[image omitted]` }];
      }
      return [part];
    }),
  }));
}
