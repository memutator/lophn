// Settings › Providers의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. provider 하나에는 연결 하나다.
// 목록은 가짜 core의 `providers/list`·`providers/definitions` 답이라 끊으면 그 정의가 Add a provider 목록으로 돌아간다.
// secret 값은 이 통로에 없다.
import {
  providerDefinitions,
  providerList,
} from "../../../../../../protocol/lophn-agent/providers.ts";
import type {
  ProviderDefinition,
  ProviderRecord,
} from "../../../../../../protocol/lophn-agent/provider-values.ts";
import { fakeAnswer } from "../../../connection/events/fake-source.ts";
import { type FakeCore, fakeCore } from "../../testdata/fake-core.ts";
import type {
  CustomProviderInput,
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

/** 화면 확인용 내장 정의. OpenAI와 xAI는 구독 로그인도 된다. Custom provider 줄은 화면이 덧붙인다. */
const DEFINITIONS: readonly ProviderDefinition[] = [
  definition("anthropic", "Anthropic", ["api_key"], null),
  definition("openai", "OpenAI", ["oauth", "api_key"], "chatgpt"),
  definition("xai", "xAI", ["oauth", "api_key"], "supergrok"),
  definition("google", "Google", ["api_key"], null),
  definition("openrouter", "OpenRouter", ["api_key"], null),
];

function definition(
  key: string,
  name: string,
  ways: readonly AuthWay[],
  product: string | null,
): ProviderDefinition {
  return {
    key,
    display_name: name,
    protocols: ["openai-chat"],
    auth_kinds: ways,
    models_endpoint: null,
    oauth: product === null ? null : { product },
    revision: "1",
  } as never;
}

type ProviderCall =
  | readonly ["disconnect", string]
  | readonly ["connect", string, Exclude<AuthWay, "none">]
  | readonly ["custom", CustomProviderInput];

/** gallery와 mock이 고르는 연결 상태. "none"은 하나도 연결하지 않았고 "some"은 Anthropic만 연결했다. 기본은 셋이 연결된 모양이다. */
type Preset = "none" | "some";

const PRESETS: Record<Preset, readonly ProviderRow[]> = {
  none: [],
  some: [CONNECTED[0]!],
};

interface FakeProvidersOptions {
  preset?: Preset;
  connected?: readonly ProviderRow[];
  /** 구독 로그인을 고르면 이 code로 기다림을 보이고 그만둘 때까지 끝나지 않는다(gallery가 기다림 화면을 고정한다). */
  signInWaits?: { userCode: string | null };
  /** registerCustom이 만드는 provider의 id. agents fake가 같은 id의 custom provider를 알게 해, 연결 뒤 목록 읽기를 gallery가 보인다. */
  customId?: string;
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<Record<"disconnect" | "connect" | "custom", string>>;
  /** 목록 답을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
}

/** 화면의 줄을 `providers/list`의 provider로 되돌린다. 화면이 읽는 칸만 채운다. */
function recordOf(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    name: row.name,
    endpoint: "https://api.example.com/v1",
    revision: row.revision,
    definition: { key: row.definition, auth_kinds: [row.way] },
    credential: {
      kind: row.way,
      state: row.state,
      unavailable_reason: row.reason,
    },
  } as never;
}

export function fakeProviders(options: FakeProvidersOptions = {}) {
  const core = options.core ?? fakeCore();
  let connected = [
    ...(options.connected ??
      (options.preset === undefined ? CONNECTED : PRESETS[options.preset])),
  ];
  let created = 0;
  const calls: ProviderCall[] = [];
  const failing = options.failing ?? {};
  const ok = <T>(value: T): SourceResult<T> => ({ ok: true, value });
  const fail = (name: keyof typeof failing): SourceResult<never> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };
  core.answers.push(
    fakeAnswer(providerList, () => ({
      as_of_seq: "0",
      next_cursor: null,
      providers: connected.map(recordOf),
    })),
    fakeAnswer(providerDefinitions, { definitions: [...DEFINITIONS] }),
  );
  const add = (row: ProviderRow) => {
    connected = [...connected, row];
    core.changed("providers", "models");
  };

  const source: ProviderSettingsSource = {
    connected() {
      return Promise.resolve(ok([...connected]));
    },
    disconnect(id) {
      calls.push(["disconnect", id]);
      const failed = fail("disconnect");
      if (failed) return Promise.resolve(failed);
      connected = connected.filter((row) => row.id !== id);
      core.changed("providers", "models");
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
          ),
        );
      }
      const failed = fail("connect");
      if (failed) return Promise.resolve(failed);
      // 연결이 되면 그 정의는 연결된 목록으로 옮겨 간다(host가 새 provider를 찾는다).
      const chosen = DEFINITIONS.find((item) => item.key === key);
      if (
        chosen !== undefined &&
        !connected.some((row) => row.definition === key)
      ) {
        add(connection(`pvd_fake_${++created}`, chosen.display_name, key, way));
      }
      return Promise.resolve(ok(null));
    },
    registerCustom(input) {
      calls.push(["custom", input]);
      const failed = fail("custom");
      if (failed) return Promise.resolve(failed);
      add(
        connection(
          options.customId ?? `pvd_fake_${++created}`,
          input.name,
          input.id,
          input.withKey ? "api_key" : "none",
        ),
      );
      return Promise.resolve(ok(null));
    },
  };
  return { source, calls, core };
}
