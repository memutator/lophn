// Settings › Providers의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. provider 하나에는 연결 하나다.
// 연결을 끊으면 그 provider는 Add a provider 목록으로 돌아간다. secret 값은 이 통로에 없다.
import type {
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
  SourceResult,
} from "../settings-source.ts";
import type { AuthWay } from "../../source.ts";

const ANTHROPIC = "pvd_01h455vb4pex5v6nkc6gd5fd11";
export const OPENAI = "pvd_01h455vb4pex5v6nkc6gd5fd12";
const XAI = "pvd_01h455vb4pex5v6nkc6gd5fd13";

function connection(
  id: string,
  name: string,
  definition: string,
  way: AuthWay,
): ProviderRow {
  return {
    id,
    name,
    definition,
    way,
    state: "available",
    reason: null,
    revision: 1,
  };
}

/** Anthropic: 로그인. OpenAI와 xAI: API key. */
const CONNECTED: readonly ProviderRow[] = [
  connection(ANTHROPIC, "Anthropic", "anthropic", "oauth"),
  connection(OPENAI, "OpenAI", "openai", "api_key"),
  connection(XAI, "xAI", "xai", "api_key"),
];

function definition(
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

const ANTHROPIC_DEFINITION = definition("anthropic", "Anthropic", {
  ways: ["oauth", "api_key"],
  signIn: { product: "Claude", verified: true },
});

const OPENAI_DEFINITION = definition("openai", "OpenAI", {
  ways: ["oauth", "api_key"],
  signIn: { product: "ChatGPT", verified: true },
});

const XAI_DEFINITION = definition("xai", "xAI");

const CUSTOM_DEFINITION = definition("custom", "Custom provider", {
  hint: "Any OpenAI-compatible endpoint",
  custom: true,
});

const AVAILABLE: readonly ProviderDefinitionRow[] = [
  definition("google", "Google", { hint: "Gemini models" }),
  definition("openrouter", "OpenRouter", {
    hint: "Models from many providers",
  }),
  CUSTOM_DEFINITION,
];

/** 끊은 뒤 다시 연결할 수 있게 연결된 provider의 정의를 key로 찾는다. */
const DEFINITIONS: Readonly<Record<string, ProviderDefinitionRow>> = {
  anthropic: ANTHROPIC_DEFINITION,
  openai: OPENAI_DEFINITION,
  xai: XAI_DEFINITION,
};

type ProviderCall =
  | readonly ["disconnect", string]
  | readonly ["connect", string, Exclude<AuthWay, "none">]
  | readonly ["custom", CustomProviderInput];

interface FakeProvidersOptions {
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
  let connected = [...(options.connected ?? CONNECTED)];
  let available = [...(options.available ?? AVAILABLE)];
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
      return Promise.resolve(fail("available") ?? ok([...available]));
    },
    disconnect(id) {
      calls.push(["disconnect", id]);
      const failed = fail("disconnect");
      if (failed) return Promise.resolve(failed);
      const gone = connected.find((row) => row.id === id);
      connected = connected.filter((row) => row.id !== id);
      const back = gone === undefined
        ? undefined
        : DEFINITIONS[gone.definition];
      if (back !== undefined) available = [back, ...available];
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
