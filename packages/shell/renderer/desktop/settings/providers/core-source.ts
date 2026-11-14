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
} from "../../../../../protocol/lophn-agent/providers.ts";
import type { ProviderDefinition } from "../../../../../protocol/lophn-agent/provider-values.ts";
import type { CoreSource } from "../../connection/connection.ts";
import {
  call,
  command,
  enterSecret,
  newProviderId,
  providerSecretName,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../core-call.ts";
import {
  customBaseUrl,
  customDefinition,
  customNeedsKey,
} from "../../../../../protocol/lophn-agent/custom-provider.ts";
import { waysOf } from "../model.ts";
import { signInProvider, timerWait } from "../sign-in.ts";
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

export interface ProviderValue {
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

/** `providers/list`의 provider 하나를 화면의 줄로. */
export function providerOf(value: ProviderValue): ProviderRow {
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

/** 아직 연결하지 않은 내장 정의와 Custom provider 줄. 연결된 provider가 쓰는 정의는 이미 연결된 것이다. */
export function availableOf(
  providers: readonly { definition: { key: string } }[],
  definitions: readonly BuiltinDefinition[],
): ProviderDefinitionRow[] {
  const used = new Set(providers.map((row) => row.definition.key));
  return [
    ...definitions
      .filter((definition) => !used.has(definition.key))
      .map(definitionRowOf),
    {
      key: CUSTOM,
      name: t("settings.title.custom-provider"),
      hint: t("settings.label.custom-provider-hint"),
      ways: ["api_key"],
      signIn: null,
      custom: true,
    },
  ];
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

  /**
   * 연결할 provider id. 값(key·token)을 쓰기 전에 목록을 새로 읽어, 그 정의가 이미 연결돼 있으면(다른 창이 먼저
   * 이었거나 이 창의 목록이 낡았다) conflict로 끝낸다. 연결된 provider의 값 자리를 덮지 않으려는 것이다.
   */
  async function freshId(definition: string): Promise<SourceResult<string>> {
    const read = await listProviders(core);
    if (!read.ok) return read;
    for (const value of read.value) ids.set(value.definition.key, value.id);
    if (read.value.some((value) => value.definition.key === definition)) {
      return { ok: false, code: "conflict" };
    }
    const known = ids.get(definition);
    if (known !== undefined) return { ok: true, value: known };
    const fresh = providerId();
    ids.set(definition, fresh);
    return { ok: true, value: fresh };
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
    const secret = providerSecretName(input.id);
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

  /** 구독 계정으로 로그인한다. 주소와 protocol은 내장 정의에서 온다. */
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
    const id = await freshId(definition.key);
    if (!id.ok) return id;
    return signInProvider(
      core,
      { openLink, random, wait },
      {
        provider: id.value,
        name: definition.display_name,
        definition,
        ...route,
      },
      progress,
    );
  }

  return {
    async connected() {
      const read = await listProviders(core);
      return read.ok ? { ok: true, value: read.value.map(providerOf) } : read;
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
      const secret = providerSecretName(provider);
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
      const id = await freshId(found.key);
      if (!id.ok) return id;
      return connectWithKey({
        id: id.value,
        name: found.display_name,
        definition: found,
        ...route,
      });
    },

    async registerCustom(input: CustomProviderInput) {
      const base = customBaseUrl(input.baseUrl);
      // 웹 주소는 key가 있어야 한다. 인증 없음은 이 컴퓨터의 주소에만 있다.
      if (base === null || (customNeedsKey(base) && !input.withKey)) {
        return { ok: false, code: "invalid_input" };
      }
      const definition = customDefinition({
        id: input.id,
        name: input.name,
        base,
        protocol: input.protocol,
        withKey: input.withKey,
      });
      const id = await freshId(input.id);
      if (!id.ok) return id;
      const connect = {
        id: id.value,
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
