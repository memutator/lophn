// ProviderSettingsSource를 main의 core 통로로 만든다(shell/desktop#R49). 응답은 main의 contract
// client가 route output schema로 이미 검사했다. 아래 모양은 그 schema(providers·provider-credentials)
// 에서 이 화면이 읽는 field만 옮긴 것이다. secret 값은 이 파일을 지나지 않는다: key·로그인 응답은
// 보호 창이 받고 여기서는 창 열기만 한다(platform/secrets#R2).
//
// core route는 있지만 renderer가 혼자 부를 수 없는 일(연결 끊기, 계정 사용 끄고 켜기, 계정 순서
// 바꾸기)은 사람 확인 창이 있어야 한다(provider-credentials/change는 confirmation: required). 그 창의
// 요청 종류가 생기기 전까지 이 통로는 core를 부르지 않고 unavailable로 답하고, 화면이 그 일만 못 했다고
// 알린다.
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
  AccountRow,
  AuthWay,
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
  SourceResult,
  WindowOutcome,
} from "./settings-source.ts";

interface CredentialValue {
  key: string;
  kind: AuthWay;
  label: string;
  enabled: boolean;
  order: number;
  account: string | null;
  organization: string | null;
  plan: string | null;
  state: AccountRow["state"];
  unavailable_reason: AccountRow["reason"];
  until: string | null;
  model_blocks: {
    model_name: string;
    reason: AccountRow["modelBlocks"][number]["reason"];
    until: string | null;
  }[];
}

export interface ProviderValue {
  id: string;
  name: string;
  enabled: boolean;
  endpoint: string;
  revision: number;
  definition: {
    key: string;
    auth_kinds: AuthWay[];
    oauth: { verified_for_lophn: boolean } | null;
  };
  credentials: CredentialValue[];
  last_check: {
    at: string;
    result: "success" | "failure";
    test_kind: "text" | "tool_call";
    model_name: string;
  } | null;
}

/** `providers/definitions`가 주는 내장 정의. 등록 command에 그대로 실으므로 원본을 쥔다. */
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

function loopback(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === "127.0.0.1" || host === "[::1]" || host === "localhost";
  } catch {
    return false;
  }
}

function accountOf(value: CredentialValue): AccountRow {
  return {
    key: value.key,
    label: value.label,
    way: value.kind,
    enabled: value.enabled,
    order: value.order,
    account: value.account,
    organization: value.organization,
    plan: value.plan,
    state: value.state,
    reason: value.unavailable_reason,
    until: value.until,
    modelBlocks: value.model_blocks.map((block) => ({
      model: block.model_name,
      reason: block.reason,
      until: block.until,
    })),
  };
}

function providerOf(value: ProviderValue): ProviderRow {
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    definition: value.definition.key,
    ways: waysOf(value.definition.auth_kinds),
    signIn: value.definition.oauth === null
      ? null
      : { verified: value.definition.oauth.verified_for_lophn },
    local: loopback(value.endpoint),
    accounts: value.credentials.map(accountOf),
    lastCheck: value.last_check === null ? null : {
      at: value.last_check.at,
      result: value.last_check.result,
      kind: value.last_check.test_kind,
      model: value.last_check.model_name,
    },
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
  /** 새 계정 key·command key를 만든다. 테스트가 고정한다. */
  random: () => string;
  /** 연결을 등록할 때 쓰는 새 provider id. */
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
  /** 이 창에서 등록한 정의 key → provider id. 같은 정의를 두 번 등록하지 않는다. */
  const registered = new Map<string, string>();

  function listDefinitions(): Promise<
    SourceResult<{ definitions: BuiltinDefinition[] }>
  > {
    return call(core, "read", "providers", "definitions", {});
  }

  const keyIntent = (
    provider: string,
    label: string,
    kind: "api_key" | "oauth",
  ): SecretIntent => ({
    kind: "secret_input",
    owner: provider,
    purpose: "provider_credential",
    credential: {
      key: `${kind === "api_key" ? "key" : "login"}-${random()}`,
      kind,
      label,
      account: null,
      organization: null,
      plan: null,
    },
  });

  /**
   * 내장 정의로 연결을 등록한다(사람 command `RegisterProvider`). key 값은 여기를 지나지 않고 이어서
   * 여는 보호 창이 받는다. 주소를 알 수 없는 정의(로컬)는 등록하지 않는다.
   */
  async function register(
    key: string,
  ): Promise<SourceResult<{ id: string; definition: BuiltinDefinition }>> {
    const read = await listDefinitions();
    if (!read.ok) return read;
    const definition = read.value.definitions.find((entry) =>
      entry.key === key
    );
    if (definition === undefined) return UNAVAILABLE;
    const known = registered.get(key);
    if (known !== undefined) {
      return { ok: true, value: { id: known, definition } };
    }
    const endpoint = baseOf(definition.models_endpoint);
    const protocol = definition.protocols[0];
    if (endpoint === null || protocol === undefined) return UNAVAILABLE;
    const id = providerId();
    const sent = await command(core, "providers", "register", {
      input: {
        id,
        name: definition.display_name,
        definition,
        endpoint,
        protocol,
      },
      key: `provider-register-${random()}`,
    });
    if (!sent.ok) return sent;
    registered.set(key, id);
    return { ok: true, value: { id, definition } };
  }

  async function signIn(
    key: string,
  ): Promise<WindowOutcome> {
    const target = await register(key);
    if (!target.ok) return target;
    const { id, definition } = target.value;
    const begun = await command<{
      login: string;
      flow: "device_code" | "device_code_then_pkce_paste_url";
      sign_in?: { url: string; user_code: string | null };
    }>(core, "providers", "login-begin", {
      input: { provider: id },
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
    return begun.value.flow === "device_code_then_pkce_paste_url"
      ? openProtected(
        openWindow,
        keyIntent(id, definition.display_name, "oauth"),
      )
      : { ok: true, value: null };
  }

  return {
    async connected() {
      const read = await listProviders(core);
      return read.ok ? { ok: true, value: read.value.map(providerOf) } : read;
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

    // 확인 창의 요청 종류가 없다(모듈 머리말). core를 부르지 않는다.
    disconnect: () => Promise.resolve(UNAVAILABLE),
    setAccountEnabled: () => Promise.resolve(UNAVAILABLE),
    reorderAccounts: () => Promise.resolve(UNAVAILABLE),

    async connect(definition, way) {
      if (way === "oauth") return await signIn(definition);
      const target = await register(definition);
      if (!target.ok) return target;
      return way === "api_key"
        ? openProtected(
          openWindow,
          keyIntent(
            target.value.id,
            target.value.definition.display_name,
            "api_key",
          ),
        )
        : { ok: true, value: null };
    },

    async registerCustom(input: CustomProviderInput) {
      const base = input.baseUrl.replace(/\/+$/, "");
      const remote = base.startsWith("https://");
      const id = providerId();
      const sent = await command(core, "providers", "register", {
        input: {
          id,
          name: input.name,
          definition: {
            key: input.id,
            display_name: input.name,
            protocols: ["openai-chat-completions"],
            // 이 컴퓨터의 http 주소를 key 없이 쓰면 인증이 없다. 그 밖은 key를 받을 수 있어야 한다.
            auth_kinds: input.withKey || remote ? ["api_key"] : ["none"],
            models_endpoint: remote ? `${base}/models` : null,
            oauth: null,
            revision: "1",
          },
          endpoint: base,
          protocol: "openai-chat-completions",
        },
        key: `provider-register-${random()}`,
      });
      if (!sent.ok) return sent;
      return input.withKey
        ? openProtected(openWindow, keyIntent(id, input.name, "api_key"))
        : { ok: true, value: null };
    },
  };
}
