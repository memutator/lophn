// OpenCode Go gateway profile. The gateway serves three wire families from one
// origin: `/go/openai/v1` (Chat Completions, Responses) and `/go/anthropic/v1`
// (Anthropic Messages). Every inference request must name its conversation in
// `x-opencode-session` — without it the gateway answers `MissingSessionID` —
// and the gateway asks clients to identify themselves with their own
// User-Agent instead of a generic SDK one. These are the gateway's published
// client rules, not a first-party API contract.

import { joinEndpoint, type ShapedCall } from "./compat.ts";
import { sha256Text } from "./stable-id.ts";

// gateway가 client를 알아보는 값이다. 판은 싣지 않는다(요청마다 같은 값이라야 routing과 cache가 흔들리지 않는다).
export const OPENCODE_GO_CLIENT = "lophn";

// model 목록은 family 정보(`api` 객체)를 싣는 OpenAI base 쪽 하나다. Anthropic base의 목록은 family를 알려 주지 않는다.
export const OPENCODE_GO_MODELS_URL =
  "https://opencode.ai/inference/go/openai/v1/models";

// 정의 key → 그 정의가 닿는 wire. 셋은 같은 gateway를 다른 wire로 부르는 별개 provider다.
const DEFINITION_WIRES = {
  "opencode-go-chat": "openai-chat-completions",
  "opencode-go-responses": "openai-responses",
  "opencode-go-messages": "anthropic-messages",
} as const;

export type OpenCodeGoDefinition = keyof typeof DEFINITION_WIRES;

export function isOpenCodeGoDefinition(
  definition: string,
): definition is OpenCodeGoDefinition {
  return Object.hasOwn(DEFINITION_WIRES, definition);
}

// 정의와 provider의 protocol이 맞을 때만 요청 모양을 준다. 맞지 않으면 null이고 invoke는 그 shape을 쓰지 않는다.
export function opencodeGoShape(
  definition: string,
  protocol: string,
):
  | ((input: {
      endpoint: string;
      session: string | null;
      body: Record<string, unknown>;
    }) => ShapedCall)
  | null {
  if (!isOpenCodeGoDefinition(definition)) return null;
  const wire = DEFINITION_WIRES[definition];
  if (wire !== protocol) return null;
  return (input) => {
    // 세 wire 모두 stream 요청만 받는다.
    const body = { ...input.body, stream: true };
    // session이 없는 call(요약처럼 turn 밖에서 도는 것)은 하나로 모아도 안전하다.
    const conversation = `ses_${sha256Text(
      `lophn.opencode-go\n${input.session ?? "call"}`,
    ).slice(0, 32)}`;
    return {
      url: joinEndpoint(
        input.endpoint,
        wire === "openai-responses"
          ? "/responses"
          : wire === "anthropic-messages"
            ? "/messages"
            : "/chat/completions",
      ),
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": OPENCODE_GO_CLIENT,
        "x-opencode-session": conversation,
        ...(wire === "anthropic-messages"
          ? { "anthropic-version": "2023-06-01" }
          : {}),
      },
      body: JSON.stringify(body),
      toolName: (name) => name,
    };
  };
}
