// ProviderSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract
// client가 route output schema로 이미 검사했다. 아래 모양은 그 schema(providers)에서 이 화면이 읽는
// field만 옮긴 것이다. secret 값은 이 파일을 지나지 않는다: key·로그인 응답은 보호 창이 받고 여기서는
// 창 열기만 한다.
//
// provider 하나에는 연결(credential) 하나라 Connect는 provider와 credential을 함께 받는
// RegisterProvider 하나다. key로 연결하는 일은 이 통로가 core를 부르지 않고 등록 정보를 실은 보호 창을
// 열면 그 창이 값을 받아 RegisterProvider를 부른다. 끊기도 확인 창을 열 뿐이다: 결정은 그 창에서만
// 받는다.
import { t } from "@lophn/wording";

import type { OpenExternalApi } from "../../../../../ipc/open-external.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import {
  call,
  command,
  newProviderId,
  openProtected,
  type OpenSecretWindow,
  type SecretIntent,
  windowLinkOpener,
  windowSecretOpener,
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
    oauth: { verified_for_lophn: boolean } | null;
  };
  credential: {
    kind: AuthWay;
    state: CredentialState;
    unavailable_reason: CredentialReason | null;
  };
}

/** `providers/definitions`가 주는 내장 정의. 연결 창이 그대로 싣기 때문에 원본을 쥔다. */
interface BuiltinDefinition {
  key: string;
  display_name: string;
  protocols: string[];
  auth_kinds: AuthWay[];
  models_endpoint: string | null;
  oauth: {
    product: string;
    flow: "device_code" | "device_code_then_pkce_paste_url";
    verified_for_lophn: boolean;
  } | null;
  revision: string;
}

/** 직접 만드는 OpenAI 호환 provider의 정의 key. */
const CUSTOM = "custom";
/** 한 번에 읽는 provider 목록 page 상한. */
const PAGE_LIMIT = 20;

/** 공식 로그인 제품의 단추 이름. */
const PRODUCTS: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  supergrok: "SuperGrok",
};

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
    signIn: value.oauth === null ? null : {
      product: PRODUCTS[value.oauth.product] ?? value.display_name,
      verified: value.oauth.verified_for_lophn,
    },
    custom: false,
  };
}

/** API base. 내장 정의의 models 주소는 `<base>/models`다(architecture §5.2). */
function baseOf(modelsEndpoint: string | null): string | null {
  return modelsEndpoint !== null && modelsEndpoint.endsWith("/models")
    ? modelsEndpoint.slice(0, -"/models".length)
    : null;
}

/** 등록된 provider를 쪽마다 모두 읽는다. */
export async function listProviders(
  core: CoreSource,
): Promise<SourceResult<ProviderValue[]>> {
  const rows: ProviderValue[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read: SourceResult<
      { providers: ProviderValue[]; next_cursor: string | null }
    > = await call(
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

export interface ProviderDeps {
  openWindow: OpenSecretWindow | undefined;
  openLink: OpenExternalApi["openExternal"] | undefined;
  now: () => number;
  /** command key를 만든다. 테스트가 고정한다. */
  random: () => string;
  /** 연결할 새 provider id. */
  providerId: () => string;
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

export function coreProviderSettingsSource(
  core: CoreSource,
  deps: Partial<ProviderDeps> = {},
): ProviderSettingsSource {
  const openWindow = "openWindow" in deps
    ? deps.openWindow
    : windowSecretOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const providerId = deps.providerId ?? (() => newProviderId(now()));
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

  /** 연결 창이 RegisterProvider에 그대로 실을 등록 정보. 값은 이 안에 없다. */
  function connectIntent(
    owner: string,
    connect: {
      name: string;
      definition: unknown;
      endpoint: string;
      protocol: string;
      kind: "api_key" | "oauth";
      login?: string;
    },
  ): SecretIntent {
    return {
      kind: "secret_input",
      owner,
      purpose: "provider_credential",
      connect,
    };
  }

  /** 내장 정의의 연결 창 등록 정보. 주소를 알 수 없는 정의는 연결하지 않는다. */
  function builtinConnect(
    definition: BuiltinDefinition,
    kind: "api_key" | "oauth",
    login?: string,
  ): SecretIntent | null {
    const endpoint = baseOf(definition.models_endpoint);
    const protocol = definition.protocols[0];
    if (endpoint === null || protocol === undefined) return null;
    return connectIntent(idFor(definition.key), {
      name: definition.display_name,
      definition,
      endpoint,
      protocol,
      kind,
      ...(login === undefined ? {} : { login }),
    });
  }

  async function signIn(definition: BuiltinDefinition): Promise<WindowOutcome> {
    if (builtinConnect(definition, "api_key") === null) return UNAVAILABLE;
    const id = idFor(definition.key);
    // provider는 아직 없다. 만들 provider의 ID와 내장 정의 key로 로그인을 시작한다.
    const begun = await command<{
      login: string;
      flow: "device_code" | "device_code_then_pkce_paste_url";
      sign_in?: { url: string; user_code: string | null };
    }>(core, "providers", "login-begin", {
      input: { provider: id, definition: definition.key },
      key: `login-begin-${random()}`,
    });
    if (!begun.ok) return begun;
    const url = begun.value.sign_in?.url;
    let opened = false;
    if (url !== undefined && openLink !== undefined) {
      try {
        opened = (await openLink(url)).ok;
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      // 열 곳이 없으면 시작한 로그인이 남지 않게 닫는다.
      await command(core, "providers", "login-cancel", {
        input: { provider: id, login: begun.value.login },
        key: `login-cancel-${random()}`,
      });
      return UNAVAILABLE;
    }
    // 최종 주소를 붙여 넣어 끝내는 방식만 응답을 받는 보호 창이 더 필요하다.
    if (begun.value.flow !== "device_code_then_pkce_paste_url") {
      return { ok: true, value: null };
    }
    const intent = builtinConnect(definition, "oauth", begun.value.login);
    return intent === null ? UNAVAILABLE : openProtected(openWindow, intent);
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

    // 끊기는 core를 부르지 않는다. 그 provider의 Disconnect 확인 창만 연다.
    disconnect(provider) {
      return openProtected(openWindow, {
        kind: "secret_input",
        owner: provider,
        purpose: "provider_credential",
        disconnect: true,
      });
    },

    async connect(definition, way) {
      const read = await listDefinitions();
      if (!read.ok) return read;
      const found = read.value.definitions.find((entry) =>
        entry.key === definition
      );
      if (found === undefined) return UNAVAILABLE;
      if (way === "oauth") return await signIn(found);
      const intent = builtinConnect(found, "api_key");
      return intent === null ? UNAVAILABLE : openProtected(openWindow, intent);
    },

    async registerCustom(input: CustomProviderInput) {
      const base = input.baseUrl.replace(/\/+$/, "");
      const remote = base.startsWith("https://");
      // 웹 주소는 key가 있어야 한다. 인증 없음은 이 컴퓨터의 주소에만 있다.
      if (remote && !input.withKey) {
        return { ok: false, code: "invalid_input" };
      }
      const definition = {
        key: input.id,
        display_name: input.name,
        protocols: ["openai-chat-completions"],
        auth_kinds: [input.withKey ? "api_key" : "none"],
        models_endpoint: remote ? `${base}/models` : null,
        oauth: null,
        revision: "1",
      };
      const id = idFor(input.id);
      if (input.withKey) {
        return openProtected(
          openWindow,
          connectIntent(id, {
            name: input.name,
            definition,
            endpoint: base,
            protocol: "openai-chat-completions",
            kind: "api_key",
          }),
        );
      }
      const sent = await command(core, "providers", "register", {
        input: {
          id,
          name: input.name,
          definition,
          endpoint: base,
          protocol: "openai-chat-completions",
          credential: { kind: "none", preparation: null },
        },
        key: `provider-register-${random()}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },
  };
}
