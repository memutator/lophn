import { z } from "zod";
import type { ProviderDefinition } from "./provider-values.ts";

// 사람이 직접 만드는 provider(Custom)의 규칙이다. Settings › Providers의 form과 agent의 secret 요청(`lophn ask secret
// --base-url`)이 같은 규칙으로 정의와 주소를 검사한다.

/** Custom provider가 말하는 API. 주소 뒤에 `/chat/completions`, `/responses`, `/messages`가 붙는다. */
export const CUSTOM_PROTOCOLS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
] as const;
export const customProtocolSchema = z.enum(CUSTOM_PROTOCOLS);
export type CustomProtocol = z.infer<typeof customProtocolSchema>;

/** 정의 key와 provider ID의 모양. */
export const CUSTOM_ID_SHAPE = /^[a-z0-9_-]+$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https 주소이거나 이 컴퓨터(127.0.0.1·::1·localhost)의 http 주소만 받는다. 뒤 `/`를 뗀 base를 준다. */
export function customBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const ok =
    url.protocol === "https:"
      ? url.hostname !== ""
      : url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  return ok ? value.trim().replace(/\/+$/, "") : null;
}

/** 웹 주소는 key 없이 연결할 수 없다. 인증 없음은 이 컴퓨터의 주소에만 있다. */
export function customNeedsKey(base: string): boolean {
  return base.startsWith("https://");
}

export function customDefinition(input: {
  id: string;
  name: string;
  base: string;
  protocol: CustomProtocol;
  withKey: boolean;
}): ProviderDefinition {
  return {
    key: input.id,
    display_name: input.name,
    protocols: [input.protocol],
    auth_kinds: [input.withKey ? "api_key" : "none"],
    models_endpoint: customNeedsKey(input.base) ? `${input.base}/models` : null,
    oauth: null,
    revision: "1",
  };
}
