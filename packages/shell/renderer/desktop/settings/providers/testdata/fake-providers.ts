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

/** OpenAI: ChatGPT 로그인. Anthropic과 xAI: API key. */
const CONNECTED: readonly ProviderRow[] = [
  connection(ANTHROPIC, "Anthropic", "anthropic", "api_key"),
  connection(OPENAI, "OpenAI", "openai", "oauth"),
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

const ANTHROPIC_DEFINITION = definition("anthropic", "Anthropic");

const OPENAI_DEFINITION = definition("openai", "OpenAI", {
  ways: ["oauth", "api_key"],
  signIn: { product: "ChatGPT", button: "continue" },
});

const XAI_DEFINITION = definition("xai", "xAI", {
  ways: ["oauth", "api_key"],
  signIn: { product: "SuperGrok", button: "sign-in" },
});

const CUSTOM_DEFINITION = definition("custom", "Custom provider", {
  hint: "Any server that speaks the OpenAI or Anthropic API",
  custom: true,
});

const OTHER_DEFINITIONS: readonly ProviderDefinitionRow[] = [
  definition("google", "Google", { hint: "Gemini models" }),
  definition("openrouter", "OpenRouter", {
    hint: "Models from many providers",
  }),
  CUSTOM_DEFINITION,
];

// 연결 상태의 기본 모양: 셋이 연결돼 있고 나머지가 Add a provider에 있다.
const AVAILABLE = OTHER_DEFINITIONS;

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

/** gallery와 mock이 고르는 연결 상태. "none"은 하나도 연결하지 않았고 "some"은 Anthropic만 연결했다. 기본은 셋이 연결된 모양이다. */
type Preset = "none" | "some";

const PRESETS: Record<
  Preset,
  {
    connected: readonly ProviderRow[];
    available: readonly ProviderDefinitionRow[];
  }
> = {
  none: {
    connected: [],
    available: [
      ANTHROPIC_DEFINITION,
      OPENAI_DEFINITION,
      XAI_DEFINITION,
      ...OTHER_DEFINITIONS,
    ],
  },
  some: {
    connected: [CONNECTED[0]],
    available: [OPENAI_DEFINITION, XAI_DEFINITION, ...OTHER_DEFINITIONS],
  },
};

interface FakeProvidersOptions {
  preset?: Preset;
  connected?: readonly ProviderRow[];
  available?: readonly ProviderDefinitionRow[];
  /** 구독 로그인을 고르면 이 code로 기다림을 보이고 그만둘 때까지 끝나지 않는다(gallery가 기다림 화면을 고정한다). */
  signInWaits?: { userCode: string | null };
  /** registerCustom이 만드는 provider의 id. agents fake가 같은 id의 custom provider를 알게 해, 연결 뒤 목록 읽기를 gallery가 보인다. */
  customId?: string;
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<
    Record<
      "connected" | "available" | "disconnect" | "connect" | "custom",
      string
    >
  >;
}

export function fakeProviders(options: FakeProvidersOptions = {}) {
  const preset = options.preset === undefined
    ? undefined
    : PRESETS[options.preset];
  let connected = [...(options.connected ?? preset?.connected ?? CONNECTED)];
  let available = [...(options.available ?? preset?.available ?? AVAILABLE)];
  let created = 0;
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
    connect(key, way, progress) {
      calls.push(["connect", key, way]);
      const waits = options.signInWaits;
      if (way === "oauth" && waits !== undefined && progress !== undefined) {
        progress.started(waits);
        return new Promise((resolve) =>
          progress.signal.addEventListener(
            "abort",
            () => resolve({ ok: false, code: "cancelled" }),
            { once: true },
          )
        );
      }
      const failed = fail("connect");
      if (failed) return Promise.resolve(failed);
      // 연결이 되면 그 정의는 연결된 목록으로 옮겨 간다(host가 새 provider를 찾는다).
      const chosen = available.find((item) => item.key === key);
      if (chosen !== undefined) {
        available = available.filter((item) => item !== chosen);
        connected = [
          ...connected,
          connection(`pvd_fake_${++created}`, chosen.name, key, way),
        ];
      }
      return Promise.resolve(ok(null));
    },
    registerCustom(input) {
      calls.push(["custom", input]);
      const failed = fail("custom");
      if (failed) return Promise.resolve(failed);
      connected = [
        ...connected,
        connection(
          options.customId ?? `pvd_fake_${++created}`,
          input.name,
          "custom",
          input.withKey ? "api_key" : "none",
        ),
      ];
      return Promise.resolve(ok(null));
    },
  };
  return { source, calls };
}
