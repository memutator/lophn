// OpenCode Go gateway profile. One subscription, one API key, one provider: the
// gateway answers each model on its native wire under one origin —
// `/go/openai/v1` (Chat Completions, Responses) and `/go/anthropic/v1`
// (Anthropic Messages). The catalog names each model's wire; this profile only
// shapes the request for it. Every inference request must name its
// conversation in `x-opencode-session` — without it the gateway answers
// `MissingSessionID` — and the gateway asks clients to identify themselves with
// their own User-Agent instead of a generic SDK one. These are the gateway's
// published client rules, not a first-party API contract.

import type { ProviderProtocol } from "../../../../protocol/lophn-agent/mod.ts";
import { joinEndpoint, type ShapedCall } from "./compat.ts";
import { sha256Text } from "./stable-id.ts";

export const OPENCODE_GO_DEFINITION = "opencode-go";

// gateway가 client를 알아보는 값이다. 판은 싣지 않는다(요청마다 같은 값이라야 routing과 cache가 흔들리지 않는다).
export const OPENCODE_GO_CLIENT = "lophn";

// provider endpoint는 OpenAI base다. Messages wire는 같은 gateway의 Anthropic base로 간다.
const OPENAI_BASE = /\/openai\/v1\/?$/;

const PATHS: Partial<Record<ProviderProtocol, string>> = {
  "openai-chat-completions": "/chat/completions",
  "openai-responses": "/responses",
};

// OpenCode Go provider의 요청 모양이다. 다른 정의나 gateway가 받지 않는 wire면 null이고 invoke는 그 shape을 쓰지 않는다.
export function opencodeGoShape(
  definition: string,
  protocol: ProviderProtocol,
):
  | ((input: {
      endpoint: string;
      session: string | null;
      body: Record<string, unknown>;
    }) => ShapedCall)
  | null {
  if (definition !== OPENCODE_GO_DEFINITION) return null;
  const messages = protocol === "anthropic-messages";
  const path = PATHS[protocol];
  if (!messages && path === undefined) return null;
  return (input) => {
    // 세 wire 모두 stream 요청만 받는다.
    const body = { ...input.body, stream: true };
    // session이 없는 call(요약처럼 turn 밖에서 도는 것)은 하나로 모아도 안전하다.
    const conversation = `ses_${sha256Text(
      `lophn.opencode-go\n${input.session ?? "call"}`,
    ).slice(0, 32)}`;
    return {
      url: messages
        ? joinEndpoint(
            input.endpoint.replace(OPENAI_BASE, "/anthropic/v1"),
            "/messages",
          )
        : joinEndpoint(input.endpoint, path!),
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": OPENCODE_GO_CLIENT,
        "x-opencode-session": conversation,
        ...(messages ? { "anthropic-version": "2023-06-01" } : {}),
      },
      body: JSON.stringify(body),
      toolName: (name) => name,
    };
  };
}
