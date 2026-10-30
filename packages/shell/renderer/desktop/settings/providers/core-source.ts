// ProviderSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract
// client가 route output schema로 이미 검사했다. 아래 모양은 그 schema(providers)에서 이 화면이 읽는
// field만 옮긴 것이다. secret 값은 이 파일을 지나지 않는다: API key는 보호 창이 받고, 구독 로그인의
// token은 core가 발급자에게 받아 저장한다.
//
// provider 하나에는 연결(credential) 하나라 Connect는 provider와 credential을 함께 받는
// ConnectProvider 하나다. key로 연결하는 일은 보호 입력 창이 값을 `secrets/put`으로 올린 뒤(`stored`)
// 이 통로가 그 이름을 실어 ConnectProvider를 부른다. 구독 로그인은 login-begin이 준 주소를 OS browser로
// 열고 login-complete를 interval마다 부른다. 끝나면 core가 token을 저장하고 Connect까지 한다.
// 끊기는 화면이 Dialog로 사람에게 물은 뒤 부른다: shell main에서 결정 handle(`provider_disconnect`)을
// 받아 DisconnectProvider에 싣는다.
import { t } from "@lophn/i18n";

import type {
  DecisionHandleApi,
  DecisionHandleReply,
} from "../../../../ipc/confirmation.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../../ipc/secret-input.ts";
import {
  connectProvider,
  disconnectProvider,
  loginBegin,
  loginCancel,
  loginComplete,
} from "../../../../../protocol/lophn-agent/providers.ts";
import type { ProviderDefinition } from "../../../../../protocol/lophn-agent/provider-values.ts";
import type { CoreSource } from "../../connection/connection.ts";
import {
  call,
  command,
  enterSecret,
  newProviderId,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../core-call.ts";
import { waysOf } from "../model.ts";
import type {
  AuthWay,
  CredentialReason,
  CredentialState,
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
  SignInProgress,
  SourceResult,
  WindowOutcome,
} from "./settings-source.ts";

interface ProviderValue {
  id: string;
  name: string;
  endpoint: string;
  revision: number;
  definition: {
    key: string;
    auth_kinds: AuthWay[];
  };
  credential: {
    kind: AuthWay;
    state: CredentialState;
    unavailable_reason: CredentialReason | null;
  };
}

/** `providers/definitions`가 주는 내장 정의. 연결 창이 그대로 싣기 때문에 원본을 쥔다. */
type BuiltinDefinition = ProviderDefinition;
type ProviderProtocol = ProviderDefinition["protocols"][number];

/** 직접 만드는 provider의 정의 key. */
const CUSTOM = "custom";
/** 한 번에 읽는 provider 목록 page 상한. */
const PAGE_LIMIT = 20;

/** 공식 로그인 제품의 단추 이름. */
const PRODUCTS: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  supergrok: "SuperGrok",
  claude: "Claude",
  antigravity: "Google Antigravity",
};
/** login-complete가 발급자에 닿지 못해 연달아 실패해도 다시 부르는 횟수. */
const COMPLETE_MISSES = 3;

function providerOf(value: ProviderValue): ProviderRow {
  return {
    id: value.id,
    name: value.name,
    definition: value.definition.key,
    way: value.credential.kind,
    state: value.credential.state,
    reason: value.credential.unavailable_reason,
    revision: value.revision,
  };
}

function definitionRowOf(value: BuiltinDefinition): ProviderDefinitionRow {
  return {
    key: value.key,
    name: value.display_name,
    hint: null,
    ways: waysOf(value.auth_kinds),
    signIn:
      value.oauth === null
        ? null
        : { product: PRODUCTS[value.oauth.product] ?? value.display_name },
    custom: false,
  };
}

/** API base. 내장 정의의 model 목록 주소는 base 바로 아래 한 칸이다(`<base>/models`, Cloud Code는 `<base>/v1internal:fetchAvailableModels`). */
function baseOf(modelsEndpoint: string | null): string | null {
  if (modelsEndpoint === null) return null;
  const cut = modelsEndpoint.lastIndexOf("/");
  return cut > "https://".length ? modelsEndpoint.slice(0, cut) : null;
}

/** 등록된 provider를 쪽마다 모두 읽는다. */
async function listProviders(
  core: CoreSource,
): Promise<SourceResult<ProviderValue[]>> {
  const rows: ProviderValue[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read: SourceResult<{
      providers: ProviderValue[];
      next_cursor: string | null;
    }> = await call(
      core,
      "read",
      "providers",
      "list",
      cursor === undefined ? {} : { cursor },
    );
    if (!read.ok) return read;
    rows.push(...read.value.providers);
    if (read.value.next_cursor === null) break;
    cursor = read.value.next_cursor;
  }
  return { ok: true, value: rows };
}

/** provider 끊기 결정의 concern과 이름. shell main의 결정 handle reader가 같은 값으로 정본을 다시 읽는다. */
const PROVIDER_CONCERN = "lophn-agent/providers";
const PROVIDER_DISCONNECT = "provider_disconnect";

/** preload의 결정 handle 요청. 없는 창에서는 undefined다. */
function windowDecisionHandle():
  | DecisionHandleApi["requestDecisionHandle"]
  | undefined {
  const shell = (globalThis as { lophnShell?: Partial<DecisionHandleApi> })
    .lophnShell;
  return typeof shell?.requestDecisionHandle === "function"
    ? (request) => shell.requestDecisionHandle!(request)
    : undefined;
}

interface ProviderDeps {
  /** API key 보호 입력 창. */
  openSecret: SecretInputOpenApi["open"] | undefined;
  openLink: OpenExternalApi["openExternal"] | undefined;
  requestHandle: DecisionHandleApi["requestDecisionHandle"] | undefined;
  now: () => number;
  /** command key를 만든다. 테스트가 고정한다. */
  random: () => string;
  /** 연결할 새 provider id. */
  providerId: () => string;
  /** 다음 login-complete까지 기다린다. signal이 끊기면 일찍 돌아온다. 테스트가 바로 돌아오게 한다. */
  wait: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

function timerWait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

export function coreProviderSettingsSource(
  core: CoreSource,
  deps: Partial<ProviderDeps> = {},
): ProviderSettingsSource {
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const requestHandle =
    "requestHandle" in deps ? deps.requestHandle : windowDecisionHandle();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const providerId = deps.providerId ?? (() => newProviderId(now()));
  const wait = deps.wait ?? timerWait;
  /**
   * 정의 key → provider id. 끊은 provider를 다시 연결하면 같은 ID로 연결해, 그 provider를 고른 agent가
   * 다시 쓸 수 있게 한다(provider 도메인 Disconnect). 이 창이 본 연결과 연결하려 만든 ID를 쥔다.
   */
  const ids = new Map<string, string>();
  function idFor(definition: string): string {
    const known = ids.get(definition);
    if (known !== undefined) return known;
    const fresh = providerId();
    ids.set(definition, fresh);
    return fresh;
  }

  function listDefinitions(): Promise<
    SourceResult<{ definitions: BuiltinDefinition[] }>
  > {
    return call(core, "read", "providers", "definitions", {});
  }

  /** 내장 정의의 연결 주소와 protocol. 주소를 알 수 없는 정의는 연결하지 않는다. */
  function routeOf(
    definition: BuiltinDefinition,
  ): { endpoint: string; protocol: ProviderProtocol } | null {
    const endpoint = baseOf(definition.models_endpoint);
    const protocol = definition.protocols[0];
    return endpoint === null || protocol === undefined
      ? null
      : { endpoint, protocol };
  }

  /**
   * API key로 연결한다. 보호 창이 값을 `secrets/put`으로 올린 뒤(`stored`)에야 그 이름을 가리키는
   * ConnectProvider를 보낸다. 연결이 실패하면 올라간 값은 쓰이지 않으니 지운다(결과는 무시).
   */
  async function connectWithKey(input: {
    id: string;
    name: string;
    definition: ProviderDefinition;
    endpoint: string;
    protocol: ProviderProtocol;
  }): Promise<WindowOutcome> {
    const secret = `provider.${input.id.slice("pvd_".length)}`;
    const entered = await enterSecret(openSecret, {
      name: secret,
      purpose: "provider",
      subject: input.name,
    });
    if (!entered.ok) return entered;
    if (entered.value === "cancelled") return { ok: true, value: null };
    const sent = await command(core, connectProvider, {
      input: { ...input, auth_kind: "api_key", credential: { secret } },
      compare: {},
      key: `provider-connect-${random()}`,
    });
    if (sent.ok) return { ok: true, value: null };
    // conflict는 같은 id의 provider가 이미 있다는 뜻이라 그 이름은 연결된 provider의 key 자리다.
    if (sent.code !== "conflict") {
      await call(core, "memory", "secrets", "delete", { name: secret });
    }
    return sent;
  }

  /**
   * 구독 계정으로 로그인한다. provider는 아직 없다: core가 로그인을 마치면 token을 저장하고 이 ID로 Connect한다.
   * 주소를 OS browser로 연 뒤 login-complete를 core가 정한 간격마다 부른다. signal이 끊기면 로그인을 그만둔다.
   */
  async function signIn(
    definition: BuiltinDefinition,
    progress: SignInProgress | undefined,
  ): Promise<WindowOutcome> {
    // ChatGPT 로그인 token은 Codex backend로 보낸다. 그 밖의 구독은 API key와 같은 주소다.
    const base = routeOf(definition);
    const route =
      base !== null && definition.oauth?.product === "chatgpt"
        ? { ...base, endpoint: definition.oauth.inference_endpoint }
        : base;
    if (route === null) return UNAVAILABLE;
    const id = idFor(definition.key);
    const begun = await command(core, loginBegin, {
      input: {
        provider: id,
        name: definition.display_name,
        definition,
        ...route,
      },
      compare: {},
      key: `login-begin-${random()}`,
    });
    if (!begun.ok) return begun;
    const login = begun.value.login;
    const cancel = () =>
      command(core, loginCancel, {
        input: { provider: id, login },
        compare: {},
        key: `login-cancel-${random()}`,
      });
    let opened = false;
    if (openLink !== undefined) {
      try {
        opened = (await openLink(begun.value.sign_in.url)).ok;
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      // 열 곳이 없으면 시작한 로그인이 남지 않게 닫는다.
      await cancel();
      return UNAVAILABLE;
    }
    progress?.started({ userCode: begun.value.sign_in.user_code });
    const signal = progress?.signal;
    let interval = begun.value.interval_ms;
    let misses = 0;
    for (;;) {
      await wait(interval, signal);
      if (signal?.aborted) {
        await cancel();
        return { ok: false, code: "cancelled" };
      }
      const step = await command(core, loginComplete, {
        input: { provider: id, login },
        compare: {},
        key: `login-complete-${random()}`,
      });
      if (!step.ok) {
        // 발급자에 잠깐 닿지 못한 것이면 다시 본다. ChatGPT는 교환이 실패하면 세션이 없어져 not_found가 온다.
        if (step.code === "unavailable" && ++misses < COMPLETE_MISSES) continue;
        if (step.code === "not_found" && misses > 0) return UNAVAILABLE;
        if (step.code === "unavailable") await cancel();
        return step;
      }
      misses = 0;
      if (step.value.state === "connected") return { ok: true, value: null };
      interval = step.value.interval_ms;
    }
  }

  return {
    async connected() {
      const read = await listProviders(core);
      if (!read.ok) return read;
      for (const value of read.value) ids.set(value.definition.key, value.id);
      return { ok: true, value: read.value.map(providerOf) };
    },

    async available() {
      const providers = await listProviders(core);
      if (!providers.ok) return providers;
      const defined = await listDefinitions();
      if (!defined.ok) return defined;
      // 연결된 provider가 쓰는 정의는 이미 연결된 것이다.
      const used = new Set(providers.value.map((row) => row.definition.key));
      const rows: ProviderDefinitionRow[] = defined.value.definitions
        .filter((definition) => !used.has(definition.key))
        .map(definitionRowOf);
      rows.push({
        key: CUSTOM,
        name: t("settings.title.custom-provider"),
        hint: t("settings.label.custom-provider-hint"),
        ways: ["api_key"],
        signIn: null,
        custom: true,
      });
      return { ok: true, value: rows };
    },

    // 끊기는 화면 안 Dialog가 한 번 물은 뒤 부른다. 결정은 shell main이 정본을 다시 읽어 묶은 handle로 싣는다.
    async disconnect(provider) {
      if (requestHandle === undefined) return UNAVAILABLE;
      const read = await call<{ provider: { revision: number } }>(
        core,
        "read",
        "providers",
        "read",
        { provider },
      );
      if (!read.ok) return read;
      let handle: DecisionHandleReply;
      try {
        handle = await requestHandle({
          concern: PROVIDER_CONCERN,
          decision: PROVIDER_DISCONNECT,
          targets: [provider],
        });
      } catch {
        return UNAVAILABLE;
      }
      if ("error" in handle) return { ok: false, code: handle.error.code };
      const sent = await command(core, disconnectProvider, {
        input: { provider },
        key: `provider-disconnect-${random()}`,
        compare: { revision: read.value.provider.revision },
        confirmation: handle.confirmation,
      });
      if (!sent.ok) return sent;
      // 값 정리는 best-effort다. 못 지워도 끊기는 끝났다. 구독 로그인은 refresh token과 meta를 옆에 둔다.
      const secret = `provider.${provider.slice("pvd_".length)}`;
      for (const name of [secret, `${secret}.refresh`, `${secret}.meta`]) {
        await call(core, "memory", "secrets", "delete", { name });
      }
      return { ok: true, value: null };
    },

    async connect(definition, way, progress) {
      const read = await listDefinitions();
      if (!read.ok) return read;
      const found = read.value.definitions.find(
        (entry) => entry.key === definition,
      );
      if (found === undefined) return UNAVAILABLE;
      if (way === "oauth") return await signIn(found, progress);
      const route = routeOf(found);
      if (route === null) return UNAVAILABLE;
      return connectWithKey({
        id: idFor(found.key),
        name: found.display_name,
        definition: found,
        ...route,
      });
    },

    async registerCustom(input: CustomProviderInput) {
      const base = input.baseUrl.replace(/\/+$/, "");
      const remote = base.startsWith("https://");
      // 웹 주소는 key가 있어야 한다. 인증 없음은 이 컴퓨터의 주소에만 있다.
      if (remote && !input.withKey) {
        return { ok: false, code: "invalid_input" };
      }
      const definition: ProviderDefinition = {
        key: input.id,
        display_name: input.name,
        protocols: [input.protocol],
        auth_kinds: [input.withKey ? "api_key" : "none"],
        models_endpoint: remote ? `${base}/models` : null,
        oauth: null,
        revision: "1",
      };
      const id = idFor(input.id);
      const connect = {
        id,
        name: input.name,
        definition,
        endpoint: base,
        protocol: input.protocol,
      };
      if (input.withKey) return connectWithKey(connect);
      const sent = await command(core, connectProvider, {
        input: { ...connect, auth_kind: "none", credential: null },
        compare: {},
        key: `provider-connect-${random()}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },
  };
}
