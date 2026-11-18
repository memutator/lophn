// ProviderSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract
// client가 route output schema로 이미 검사했다. 아래 모양은 그 schema(providers)에서 이 화면이 읽는
// field만 옮긴 것이다. secret 값은 이 파일을 지나지 않는다: API key는 보호 창이 받고, 구독 로그인의
// token은 core가 발급자에게 받아 저장한다.
//
// 잇는 순서(id 정하기, 값 넣기, 이미 이어졌는지 보기, Connect)는 core가 쥔다. key로 잇는 일은 보호 입력 창을 연결 대상
// (정의 key나 Custom)으로 열면 shell main이 값을 core `providers/connect-key`로 올려 끝낸다. 이 컴퓨터의 주소에 인증 없이
// 잇는 Custom은 `providers/connect-local`이다. 구독 로그인은 `providers/sign-in`이 시작하고 core가 기다린다(sign-in.ts).
// 끊기는 화면이 Dialog로 사람에게 물은 뒤 부른다: shell main에서 결정 handle(`provider_disconnect`)을
// 받아 DisconnectProvider에 싣는다. 값은 core가 지운다. 다른 기계의 범위은 handle 없이 보낸다: 터미널 입력을 허락받은 기기가
// 보낸 확인 command에는 그 기계의 core가 handle을 붙인다(이 컴퓨터의 shell main은 그 기계의 handle을 받지 못한다).
import { t } from "@lophn/i18n";

import type {
  DecisionHandleApi,
  DecisionHandleReply,
} from "../../../../ipc/confirmation.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../../ipc/secret-input.ts";
import { disconnectProvider } from "../../../../../protocol/lophn-agent/providers.ts";
import {
  oauthFlowOf,
  type ProviderDefinition,
} from "../../../../../protocol/lophn-agent/provider-values.ts";
import type { CoreSource } from "../../connection/connection.ts";
import {
  call,
  command,
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../core-call.ts";
import {
  customBaseUrl,
  customNeedsKey,
} from "../../../../../protocol/lophn-agent/custom-provider.ts";
import { waysOf } from "../model.ts";
import { followProviderSignIn } from "../sign-in.ts";
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
        : {
            product: PRODUCTS[value.oauth.product] ?? value.display_name,
            deviceCode: oauthFlowOf(value.oauth.product) === "device_code",
          },
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
  /** command key를 만든다. 테스트가 고정한다. */
  random: () => string;
  /** 다른 기계의 범위이다. 끊기는 결정 handle 없이 보내고 그 기계의 core가 붙인다. */
  machine: boolean;
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
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const machine = deps.machine ?? false;

  function listDefinitions(): Promise<
    SourceResult<{ definitions: BuiltinDefinition[] }>
  > {
    return call(core, "read", "providers", "definitions", {});
  }

  return {
    async connected() {
      const read = await listProviders(core);
      return read.ok ? { ok: true, value: read.value.map(providerOf) } : read;
    },

    // 끊기는 화면 안 Dialog가 한 번 물은 뒤 부른다. 결정은 shell main이 정본을 다시 읽어 묶은 handle로 싣는다.
    async disconnect(provider) {
      if (!machine && requestHandle === undefined) return UNAVAILABLE;
      const read = await call<{ provider: { revision: number } }>(
        core,
        "read",
        "providers",
        "read",
        { provider },
      );
      if (!read.ok) return read;
      let handle: DecisionHandleReply | null = null;
      if (!machine) {
        try {
          handle = await requestHandle!({
            concern: PROVIDER_CONCERN,
            decision: PROVIDER_DISCONNECT,
            targets: [provider],
          });
        } catch {
          return UNAVAILABLE;
        }
        if ("error" in handle) return { ok: false, code: handle.error.code };
      }
      const sent = await command(core, disconnectProvider, {
        input: { provider },
        key: `provider-disconnect-${random()}`,
        compare: { revision: read.value.provider.revision },
        ...(handle === null ? {} : { confirmation: handle.confirmation }),
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },

    async connect(definition, way, progress) {
      if (way === "oauth") {
        return await followProviderSignIn(
          progress?.events ?? null,
          openLink,
          { definition },
          progress,
        );
      }
      const read = await listDefinitions();
      if (!read.ok) return read;
      const found = read.value.definitions.find(
        (entry) => entry.key === definition,
      );
      if (found === undefined) return UNAVAILABLE;
      const entered = await enterSecret(openSecret, {
        provider: { definition },
        subject: found.display_name,
      });
      return entered.ok ? { ok: true, value: null } : entered;
    },

    async registerCustom(input: CustomProviderInput) {
      const base = customBaseUrl(input.baseUrl);
      // 웹 주소는 key가 있어야 한다. 인증 없음은 이 컴퓨터의 주소에만 있다.
      if (base === null || (customNeedsKey(base) && !input.withKey)) {
        return { ok: false, code: "invalid_input" };
      }
      const custom = {
        key: input.id,
        name: input.name,
        base_url: base,
        protocol: input.protocol,
      };
      if (input.withKey) {
        const entered = await enterSecret(openSecret, {
          provider: { custom },
          subject: input.name,
        });
        return entered.ok ? { ok: true, value: null } : entered;
      }
      const sent = await call(core, "memory", "providers", "connect-local", {
        custom,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },
  };
}
