// ChatGPT 구독 token을 Codex backend(`chatgpt.com/backend-api/codex/responses`)로 보내는 모양이다. 본문은 Responses
// packer가 만든 것이고 여기서는 Codex backend가 받는 모양으로만 바꾼다(omp·opencode·codex-rs와 같은 규칙).
// - prompt cache 자리: 본문 `prompt_cache_key`와 `session_id`·`conversation_id`·`session-id` header에 session에서 만든
//   같은 값을 싣는다. Codex backend는 이 값으로 cache를 가진 machine을 고른다. 없으면 매 요청이 다른 machine으로 가
//   앞부분이 같아도 cache를 못 읽는다.
// - `max_output_tokens`는 Codex backend가 거절해 뺀다.
// - encrypted reasoning을 늘 돌려받는다(`include`).
// header 값은 2026-10 조사 snapshot의 Codex client profile이고 OpenAI가 제3자에게 공개 보장한 API가 아니다.

import type { ProviderAccount } from "../../../../protocol/lophn-agent/mod.ts";
import { CODEX_ORIGINATOR } from "../oauth-chatgpt.ts";
import { joinEndpoint, type ShapedCall } from "./compat.ts";
import { stableUuid } from "./stable-id.ts";

// backend가 model 목록과 응답을 이 판으로 거른다. 낮으면 새 model이 목록에서 빠진다.
export const CODEX_CLIENT_VERSION = "0.159.0";
const RESPONSES_PATH = "/responses";

export function codexShape(options: {
  // 연결한 provider ID다. session이 없을 때의 cache 열쇠다.
  provider: string;
  account: ProviderAccount | null;
}): (input: {
  endpoint: string;
  session: string | null;
  body: Record<string, unknown>;
}) => ShapedCall {
  const accountId = options.account?.id ?? null;
  return (input) => {
    const conversation = stableUuid(
      "lophn.codex.session",
      input.session ?? options.provider,
    );
    const { max_output_tokens: _, include, ...rest } = input.body;
    const asked = Array.isArray(include) ? include : [];
    const body = {
      ...rest,
      store: false,
      stream: true,
      include: [...new Set([...asked, "reasoning.encrypted_content"])],
      prompt_cache_key: conversation,
    };
    return {
      url: joinEndpoint(input.endpoint, RESPONSES_PATH),
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "OpenAI-Beta": "responses=experimental",
        originator: CODEX_ORIGINATOR,
        version: CODEX_CLIENT_VERSION,
        session_id: conversation,
        conversation_id: conversation,
        "session-id": conversation,
        ...(accountId === null ? {} : { "chatgpt-account-id": accountId }),
      },
      body: JSON.stringify(body),
      toolName: (name) => name,
    };
  };
}

// Codex backend의 model 목록 주소다. 응답은 `models[]`이고 이름은 `slug`다.
export function codexModelsUrl(endpoint: string): string {
  const url = new URL(joinEndpoint(endpoint, "/models"));
  url.searchParams.set("client_version", CODEX_CLIENT_VERSION);
  return url.toString();
}

export function codexModelsHeaders(
  account: ProviderAccount | null,
): Record<string, string> {
  return {
    accept: "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: CODEX_ORIGINATOR,
    version: CODEX_CLIENT_VERSION,
    ...(account?.id == null ? {} : { "chatgpt-account-id": account.id }),
  };
}
