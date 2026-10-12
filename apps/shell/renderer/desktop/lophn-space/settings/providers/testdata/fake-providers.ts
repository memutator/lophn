// Settings › Providers test의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. provider 하나에는
// 연결 하나라 계정 순서나 끄기 호출은 없다. secret 값은 이 통로에 없다.
import type {
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderSettingsSource,
  SourceResult,
} from "../settings-source.ts";
import { provider } from "../../testdata/fake-settings.ts";
import type { AuthWay, ProviderRow } from "../../source.ts";

export const ANTHROPIC = "pvd_01h455vb4pex5v6nkc6gd5fd11";
export const OPENAI = "pvd_01h455vb4pex5v6nkc6gd5fd12";
export const XAI = "pvd_01h455vb4pex5v6nkc6gd5fd13";

/** Anthropic: API key. OpenAI: ChatGPT 로그인. xAI: API key이고 사용량 한도에 닿아 기다리는 중. */
export const CONNECTED: readonly ProviderRow[] = [
  provider(ANTHROPIC, "Anthropic", {
    definition: "anthropic",
    way: "api_key",
  }),
  provider(OPENAI, "OpenAI", {
    definition: "openai",
    way: "oauth",
  }),
  provider(XAI, "xAI", {
    definition: "xai",
    way: "api_key",
    state: "usage_wait",
    reason: "quota",
  }),
];

export function definition(
  key: string,
  name: string,
  options: Partial<Omit<ProviderDefinitionRow, "key" | "name">> = {},
): ProviderDefinitionRow {
  return {
    key,
    name,
    hint: null,
    ways: ["api_key"],
    signIn: null,
    custom: false,
    ...options,
  };
}

export const OPENAI_DEFINITION = definition("openai", "OpenAI", {
  ways: ["oauth", "api_key"],
  signIn: { product: "ChatGPT", verified: true },
});

export const CUSTOM_DEFINITION = definition("custom", "Custom provider", {
  hint: "Any OpenAI-compatible endpoint",
  custom: true,
});

export const AVAILABLE: readonly ProviderDefinitionRow[] = [
  definition("google", "Google", { hint: "Gemini models" }),
  definition("openrouter", "OpenRouter", {
    hint: "Models from many providers",
  }),
  CUSTOM_DEFINITION,
];

export type ProviderCall =
  | readonly ["disconnect", string]
  | readonly ["connect", string, Exclude<AuthWay, "none">]
  | readonly ["custom", CustomProviderInput];

export interface FakeProvidersOptions {
  connected?: readonly ProviderRow[];
  available?: readonly ProviderDefinitionRow[];
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<
    Record<
      "connected" | "available" | "disconnect" | "connect" | "custom",
      string
    >
  >;
}

export function fakeProviders(options: FakeProvidersOptions = {}) {
  const connected = [...(options.connected ?? CONNECTED)];
  const calls: ProviderCall[] = [];
  const failing = options.failing ?? {};
  const ok = <T>(value: T): SourceResult<T> => ({ ok: true, value });
  const fail = (name: keyof typeof failing): SourceResult<never> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };

  const source: ProviderSettingsSource = {
    connected() {
      return Promise.resolve(fail("connected") ?? ok([...connected]));
    },
    available() {
      return Promise.resolve(
        fail("available") ?? ok([...(options.available ?? AVAILABLE)]),
      );
    },
    disconnect(id) {
      calls.push(["disconnect", id]);
      return Promise.resolve(fail("disconnect") ?? ok(null));
    },
    connect(key, way) {
      calls.push(["connect", key, way]);
      return Promise.resolve(fail("connect") ?? ok(null));
    },
    registerCustom(input) {
      calls.push(["custom", input]);
      return Promise.resolve(fail("custom") ?? ok(null));
    },
  };
  return { source, calls };
}
