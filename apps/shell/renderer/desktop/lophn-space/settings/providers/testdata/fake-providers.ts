// Settings › Providers test의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. 계정 순서와
// 사용 켜기·끄기는 성공하면 다음 읽기에 반영한다. secret 값은 이 통로에 없다.
import type {
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderSettingsSource,
  SourceResult,
} from "../settings-source.ts";
import { account, provider } from "../../testdata/fake-settings.ts";
import type { AccountRow, ProviderRow } from "../../source.ts";

export const ANTHROPIC = "pvd_01h455vb4pex5v6nkc6gd5fd11";
export const OPENAI = "pvd_01h455vb4pex5v6nkc6gd5fd12";
export const XAI = "pvd_01h455vb4pex5v6nkc6gd5fd13";

/** Anthropic: API key 계정 셋. 셋째는 사용을 꺼 두었다. */
const ANTHROPIC_ACCOUNTS: readonly AccountRow[] = [
  account("work", "Work key", { order: 0 }),
  account("personal", "Personal key", { order: 1 }),
  account("spare", "Spare key", { order: 2, enabled: false }),
];

/** OpenAI: ChatGPT 로그인(요금제 Plus)과 API key. */
const OPENAI_ACCOUNTS: readonly AccountRow[] = [
  account("chatgpt", "ChatGPT account", {
    way: "oauth",
    order: 0,
    plan: "Plus",
  }),
  account("team", "Team key", { order: 1 }),
];

export const CONNECTED: readonly ProviderRow[] = [
  provider(ANTHROPIC, "Anthropic", {
    definition: "anthropic",
    ways: ["api_key"],
    accounts: ANTHROPIC_ACCOUNTS,
  }),
  provider(OPENAI, "OpenAI", {
    definition: "openai",
    ways: ["oauth", "api_key"],
    signIn: { verified: true },
    accounts: OPENAI_ACCOUNTS,
  }),
  provider(XAI, "xAI", {
    definition: "xai",
    ways: ["api_key"],
    accounts: [account("xai-key", "xAI key", { order: 0 })],
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
  definition("ollama", "Ollama (local)", {
    hint: "Models on this computer",
    ways: ["none"],
  }),
  CUSTOM_DEFINITION,
];

export type ProviderCall =
  | readonly ["disconnect", string]
  | readonly ["enabled", string, string, boolean]
  | readonly ["reorder", string, readonly string[]]
  | readonly ["connect", string, string]
  | readonly ["custom", CustomProviderInput];

export interface FakeProvidersOptions {
  connected?: readonly ProviderRow[];
  available?: readonly ProviderDefinitionRow[];
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<
    Record<
      | "connected"
      | "available"
      | "disconnect"
      | "enabled"
      | "reorder"
      | "connect"
      | "custom",
      string
    >
  >;
}

export function fakeProviders(options: FakeProvidersOptions = {}) {
  let connected = [...(options.connected ?? CONNECTED)];
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
    setAccountEnabled(id, key, enabled) {
      calls.push(["enabled", id, key, enabled]);
      const failed = fail("enabled");
      if (failed) return Promise.resolve(failed);
      connected = connected.map((row) =>
        row.id !== id ? row : {
          ...row,
          accounts: row.accounts.map((item) =>
            item.key === key ? { ...item, enabled } : item
          ),
        }
      );
      return Promise.resolve(ok(null));
    },
    reorderAccounts(id, keys) {
      calls.push(["reorder", id, [...keys]]);
      const failed = fail("reorder");
      if (failed) return Promise.resolve(failed);
      connected = connected.map((row) =>
        row.id !== id ? row : {
          ...row,
          accounts: keys.map((key, order) => ({
            ...row.accounts.find((item) => item.key === key)!,
            order,
          })),
        }
      );
      return Promise.resolve(ok(null));
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
