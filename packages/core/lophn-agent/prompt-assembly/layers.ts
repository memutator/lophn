import { canonicalize } from "../../../base/mod.ts";
import type {
  HistoryMessage,
  PromptMessage,
  PromptPart,
  PromptRequest,
} from "./model.ts";

// 층 본문과 직렬화다. 같은 재료는 같은 값을 낸다. 시각·무작위·입력 순서에 기대지
// 않는다. 경계는 층 구조에서만 나오고 본문 문자열을 찾아 정하지 않는다.

function canonicalValue<T>(value: T): T {
  return JSON.parse(canonicalize(value)) as T;
}

// reasoning 본문은 prompt에 넣지 않는다. 조각이 모두 빠진 message는 없다.
export function historyMessages(
  history: readonly HistoryMessage[],
): PromptMessage[] {
  const messages: PromptMessage[] = [];
  for (const message of history) {
    const parts: PromptPart[] = [];
    for (const part of message.parts) {
      if (part.kind === "reasoning") continue;
      parts.push(
        part.kind === "tool_use"
          ? { ...part, input: canonicalValue(part.input) }
          : { ...part },
      );
    }
    if (parts.length > 0) messages.push({ role: message.role, parts });
  }
  return messages;
}

// ---- Anthropic wire 대응 ----
// Anthropic 요청은 tools → system → messages 순이다. 그래서 workspace_kind 층 system 끝의 marker가 tools를
// 함께 덮는다. tools에는 marker를 따로 달지 않으므로 논리 경계 세 곳이 wire marker 세 개 이하다.

const EPHEMERAL = { type: "ephemeral" } as const;

export function anthropicSystem(request: PromptRequest) {
  return request.system.map((block) => ({
    type: "text" as const,
    text: block.text,
    ...(block.cache === false ? {} : { cache_control: EPHEMERAL }),
  }));
}

export function anthropicTools(request: PromptRequest) {
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}
