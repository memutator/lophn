// OpenCode Go gateway profile. One subscription, one API key, one provider: the
// gateway answers each model on its native wire under one origin —
// `/go/openai/v1` (Chat Completions, Responses), `/go/anthropic/v1` (Anthropic
// Messages) and `/go/google/v1beta` (Gemini generateContent). The catalog names
// each model's wire; this profile only shapes the request for it. Every
// inference request must name its conversation in `x-opencode-session` —
// without it the gateway answers `MissingSessionID` — and the gateway asks
// clients to identify themselves with their own User-Agent instead of a generic
// SDK one. These are the gateway's published client rules, not a first-party
// API contract.

import type { ProviderProtocol } from "../../../../protocol/lophn-agent/mod.ts";
import { joinEndpoint, type ShapedCall } from "./compat.ts";
import { sha256Text } from "./stable-id.ts";

export const OPENCODE_GO_DEFINITION = "opencode-go";

// gateway가 client를 알아보는 값이다. 판은 싣지 않는다(요청마다 같은 값이라야 routing과 cache가 흔들리지 않는다).
export const OPENCODE_GO_CLIENT = "lophn";

// provider endpoint는 OpenAI base다. 다른 wire는 같은 gateway의 다른 base로 간다.
const OPENAI_BASE = /\/openai\/v1\/?$/;

// wire → 보낼 주소. Gemini는 model 이름이 경로에 들어간다.
const URLS: Partial<
  Record<ProviderProtocol, (endpoint: string, model: string) => string>
> = {
  "openai-chat-completions": (endpoint) =>
    joinEndpoint(endpoint, "/chat/completions"),
  "openai-responses": (endpoint) => joinEndpoint(endpoint, "/responses"),
  "anthropic-messages": (endpoint) =>
    joinEndpoint(endpoint.replace(OPENAI_BASE, "/anthropic/v1"), "/messages"),
  "gemini-generate-content": (endpoint, model) =>
    joinEndpoint(
      endpoint.replace(OPENAI_BASE, "/google/v1beta"),
      `/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    ),
};

// OpenCode Go provider의 요청 모양이다. 다른 정의나 gateway가 받지 않는 wire면 null이고 invoke는 그 shape을 쓰지 않는다.
export function opencodeGoShape(
  definition: string,
  protocol: ProviderProtocol,
  model: string,
):
  | ((input: {
      endpoint: string;
      session: string | null;
      body: Record<string, unknown>;
    }) => ShapedCall)
  | null {
  if (definition !== OPENCODE_GO_DEFINITION) return null;
  const url = URLS[protocol];
  if (url === undefined) return null;
  const gemini = protocol === "gemini-generate-content";
  return (input) => {
    // OpenAI·Anthropic wire는 body의 stream으로 stream을 고른다. Gemini는 경로(`streamGenerateContent?alt=sse`)가 고른다.
    const body = gemini ? input.body : { ...input.body, stream: true };
    // session이 없는 call(요약처럼 turn 밖에서 도는 것)은 하나로 모아도 안전하다.
    const conversation = `ses_${sha256Text(
      `lophn.opencode-go\n${input.session ?? "call"}`,
    ).slice(0, 32)}`;
    return {
      url: url(input.endpoint, model),
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": OPENCODE_GO_CLIENT,
        "x-opencode-session": conversation,
        ...(protocol === "anthropic-messages"
          ? { "anthropic-version": "2023-06-01" }
          : {}),
      },
      body: JSON.stringify(body),
      toolName: (name) => name,
    };
  };
}
