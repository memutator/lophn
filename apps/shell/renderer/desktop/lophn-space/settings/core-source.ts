// SettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다.
// secret 값은 이 파일을 지나지 않는다: key·로그인 응답은 보호 창이 받고 여기서는 창 열기만 한다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowFolderPicker } from "../../launcher/core-source.ts";
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import type {
  AccountRow,
  ApplyAt,
  AuthWay,
  CostKind,
  CostLine,
  ModelChoice,
  ModelDefaults,
  NewServer,
  ProviderRow,
  ServerAuth,
  ServerRow,
  SettingRow,
  SettingsSource,
  SettingsView,
  SourceResult,
  TestKind,
  TestResult,
  UsageRow,
  WindowOutcome,
} from "./source.ts";
import { waysOf } from "./model.ts";

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

interface ProviderValue {
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
    test_kind: TestKind;
    model_name: string;
  } | null;
}

interface SelectionValue {
  provider: string;
  model_name: string;
}

interface DefinitionValue {
  key: string;
  description: string;
  default_present: boolean;
  default?: unknown;
}

interface EffectiveValue {
  key: string;
  resolved: boolean;
  value: unknown;
  source_layer: "builtin" | "common" | null;
  apply_at: ApplyAt;
}

interface McpServerValue {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  http?: {
    auth: {
      kind: ServerAuth;
      secret_ref?: string;
    };
  };
}

const SKILL_FOLDERS = "lophn-agent.extensions.skill_folders";
const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
/** 한 번에 읽는 provider 목록 page 상한. */
const PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: { input: unknown; compare?: unknown; key: string },
): Promise<SourceResult<T>> {
  return call<T>(core, "command", resource, method, {
    input: body.input,
    idempotency_key: body.key,
    ...(body.compare === undefined ? {} : { compare: body.compare }),
    prepared: [],
  });
}

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

function choiceOf(value: SelectionValue | null): ModelChoice | null {
  return value === null
    ? null
    : { provider: value.provider, model: value.model_name };
}

function defaultsOf(
  value: {
    judgment: SelectionValue | null;
    organizing: SelectionValue | null;
    settings_seq: string;
  },
): ModelDefaults {
  return {
    decisions: choiceOf(value.judgment),
    summaries: choiceOf(value.organizing),
    seq: value.settings_seq,
    raw: { decisions: value.judgment, summaries: value.organizing },
  };
}

/** 같은 종류·통화의 줄을 하나로 모은다. 모르는 비용은 금액 없이 호출 수만 센다. */
function mergeCosts(
  costs: readonly {
    kind: CostKind;
    currency: string | null;
    amount: string | null;
    calls: number;
  }[],
): CostLine[] {
  const merged = new Map<string, { line: CostLine; sum: number }>();
  for (const cost of costs) {
    const key = `${cost.kind}/${cost.currency ?? ""}`;
    const found = merged.get(key);
    const amount = cost.amount === null ? null : Number(cost.amount);
    if (found === undefined) {
      merged.set(key, {
        line: { ...cost },
        sum: amount ?? 0,
      });
    } else {
      found.sum += amount ?? 0;
      merged.set(key, {
        line: { ...found.line, calls: found.line.calls + cost.calls },
        sum: found.sum,
      });
    }
  }
  return [...merged.values()].map(({ line, sum }) => ({
    ...line,
    amount: line.amount === null ? null : String(sum),
  }));
}

/** preload의 shell 링크 열기. 없는 창이면 undefined다. */
export function windowLinkOpener():
  | OpenExternalApi["openExternal"]
  | undefined {
  const shell = (globalThis as { lophnShell?: Partial<OpenExternalApi> })
    .lophnShell;
  return typeof shell?.openExternal === "function"
    ? (url) => shell.openExternal!(url)
    : undefined;
}

type SecretIntent = {
  readonly kind: "secret_input";
  readonly owner: string;
  readonly purpose: string;
  readonly credential?: {
    readonly key: string;
    readonly kind: "api_key" | "oauth";
    readonly label: string;
    readonly account: null;
    readonly organization: null;
    readonly plan: null;
  };
  readonly change?: {
    readonly key: string;
    readonly action: "replace" | "revoke";
  };
};

/** preload의 보호 창 열기. 없는 창에서는 undefined다. */
export type OpenSecretWindow = (
  intent: { request: SecretIntent; parentWindow: string },
) => Promise<unknown>;

export function windowSecretOpener(): OpenSecretWindow | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenSecretWindow };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";

export interface SettingsDeps {
  openWindow: OpenSecretWindow | undefined;
  openLink: OpenExternalApi["openExternal"] | undefined;
  picker: FolderPickerApi | undefined;
  now: () => number;
  /** 새 계정 key·command key를 만든다. 테스트가 고정한다. */
  random: () => string;
}

export function coreSettingsSource(
  core: CoreSource,
  deps: Partial<SettingsDeps> = {},
): SettingsSource {
  const openWindow = "openWindow" in deps
    ? deps.openWindow
    : windowSecretOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));

  async function openProtected(intent: SecretIntent): Promise<WindowOutcome> {
    if (openWindow === undefined) return { ok: false, code: "unavailable" };
    try {
      const opened = await openWindow({
        request: intent,
        parentWindow: PARENT_WINDOW,
      }) as { windowId?: string; code?: string };
      return typeof opened?.windowId === "string"
        ? { ok: true, value: null }
        : { ok: false, code: opened?.code ?? "internal" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }

  const credentialIntent = (
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

  const changeIntent = (
    provider: string,
    key: string,
    action: "replace" | "revoke",
  ): SecretIntent => ({
    kind: "secret_input",
    owner: provider,
    purpose: "provider_credential",
    change: { key, action },
  });

  async function apply(
    view: SettingsView,
    key: string,
    value: unknown,
  ): Promise<SourceResult<null>> {
    const result = await command(core, "settings", "apply", {
      input: { changes: [{ layer: "common", key, action: "set", value }] },
      compare: {
        revision: view.revision,
        defaults_revision: view.defaultsRevision,
      },
      key: `settings-${key}-${random()}`,
    });
    return result.ok ? { ok: true, value: null } : result;
  }

  async function secretStates(
    names: readonly string[],
  ): Promise<Map<string, "set" | "missing"> | null> {
    if (names.length === 0) return new Map();
    const read = await call<{
      secrets: { name: string; configured: boolean }[];
    }>(core, "read", "secrets", "list", { names });
    if (!read.ok) return null;
    return new Map(
      read.value.secrets.map((
        status,
      ) => [status.name, status.configured ? "set" : "missing"]),
    );
  }

  return {
    watch: (listener) => core.subscribe(listener),

    async providers() {
      const rows: ProviderRow[] = [];
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
        rows.push(...read.value.providers.map(providerOf));
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async usage(account) {
      const through = now();
      const read = await call<{
        totals: {
          calls: number;
          costs: {
            kind: CostKind;
            currency: string | null;
            amount: string | null;
            calls: number;
          }[];
          complete: boolean;
        }[];
      }>(core, "read", "agent-usage", "read", {
        credential_key: account,
        from_at: new Date(through - THIRTY_DAYS).toISOString(),
        through_at: new Date(through).toISOString(),
      });
      if (!read.ok) return read;
      const usage: UsageRow = {
        calls: read.value.totals.reduce((sum, total) => sum + total.calls, 0),
        costs: mergeCosts(read.value.totals.flatMap((total) => total.costs)),
        complete: read.value.totals.every((total) => total.complete),
      };
      return { ok: true, value: usage };
    },

    async models(definition) {
      const read = await call<{ entries: { model_name: string }[] }>(
        core,
        "read",
        "agent-model-catalog",
        "read",
        { provider_definition: definition },
      );
      if (!read.ok) return read;
      const names = [...new Set(read.value.entries.map((e) => e.model_name))];
      return { ok: true, value: names.sort((a, b) => a.localeCompare(b)) };
    },

    async testConnection(input) {
      const results: TestResult[] = [];
      for (const kind of ["text", "tool_call"] as const) {
        const key = `test-${kind}-${random()}`;
        const sent = await command<{
          check: { result: "success" | "failure" } | null;
          timeout_ms: number;
        }>(core, "providers", "test", {
          input: {
            provider: input.provider,
            credential_key: input.account,
            model_name: input.model,
            test_kind: kind,
            command_key: key,
          },
          key,
        });
        if (!sent.ok) return sent;
        results.push({
          kind,
          result: sent.value.check?.result ?? null,
          timeoutSeconds: Math.round(sent.value.timeout_ms / 1000),
        });
      }
      return { ok: true, value: results };
    },

    async beginSignIn(provider) {
      const begun = await command<{
        login: string;
        flow: "device_code" | "device_code_then_pkce_paste_url";
        sign_in?: { url: string; user_code: string | null };
      }>(core, "providers", "login-begin", {
        input: { provider },
        key: `login-begin-${random()}`,
      });
      if (!begun.ok) return begun;
      return {
        ok: true,
        value: {
          login: begun.value.login,
          url: begun.value.sign_in?.url ?? null,
          code: begun.value.sign_in?.user_code ?? null,
          paste: begun.value.flow === "device_code_then_pkce_paste_url",
        },
      };
    },

    async cancelSignIn(provider, login) {
      const result = await command(core, "providers", "login-cancel", {
        input: { provider, login },
        key: `login-cancel-${random()}`,
      });
      return result.ok ? { ok: true, value: null } : result;
    },

    async openLink(url) {
      if (openLink === undefined) return false;
      try {
        return (await openLink(url)).ok;
      } catch {
        return false;
      }
    },

    connectKey: (provider, label) =>
      openProtected(credentialIntent(provider, label, "api_key")),
    enterSignInResponse: (provider, label) =>
      openProtected(credentialIntent(provider, label, "oauth")),
    replaceKey: (provider, account) =>
      openProtected(changeIntent(provider, account, "replace")),
    removeAccount: (provider, account) =>
      openProtected(changeIntent(provider, account, "revoke")),

    async modelDefaults() {
      const read = await call<{
        defaults: Parameters<typeof defaultsOf>[0];
      }>(core, "read", "agent-model-defaults", "read", {});
      return read.ok
        ? { ok: true, value: defaultsOf(read.value.defaults) }
        : read;
    },

    async setModelDefault(use, pick, defaults) {
      const chosen = {
        provider: pick.provider,
        credentials: [...pick.accounts],
        model_name: pick.model,
        reasoning_level: "provider_default",
        options: {},
      };
      const input = {
        judgment: use === "decisions" ? chosen : defaults.raw.decisions,
        organizing: use === "summaries" ? chosen : defaults.raw.summaries,
        settings_seq: defaults.seq,
      };
      const changed = await command<
        Parameters<typeof defaultsOf>[0]
      >(core, "agent-model-defaults", "change", {
        input,
        compare: { settings_seq: defaults.seq },
        key: `model-defaults-${use}-${random()}`,
      });
      return changed.ok
        ? { ok: true, value: defaultsOf(changed.value) }
        : changed;
    },

    async settings() {
      const defined = await call<
        { definitions: DefinitionValue[]; defaults_revision: string }
      >(core, "read", "settings", "definitions", {});
      if (!defined.ok) return defined;
      const got = await call<{
        settings: EffectiveValue[];
        revision: number;
        defaults_revision: string;
      }>(core, "read", "settings", "get", {});
      if (!got.ok) return got;
      const effective = new Map(got.value.settings.map((s) => [s.key, s]));
      const rows: SettingRow[] = defined.value.definitions.flatMap(
        (definition) => {
          const current = effective.get(definition.key);
          if (current === undefined) return [];
          return [{
            key: definition.key,
            title: definition.description,
            value: current.value,
            resolved: current.resolved,
            changed: current.source_layer === "common",
            defaultValue: definition.default,
            hasDefault: definition.default_present,
            applyAt: current.apply_at,
          }];
        },
      );
      const folders = effective.get(SKILL_FOLDERS);
      const servers = effective.get(MCP_SERVERS);
      const serverValues = Array.isArray(servers?.value)
        ? servers.value as McpServerValue[]
        : [];
      const secretOf = (server: McpServerValue): string | null => {
        const ref = server.http?.auth.secret_ref;
        return ref !== undefined && ref.startsWith("sec:")
          ? ref.slice(4)
          : null;
      };
      const states = await secretStates(
        serverValues.flatMap((server) => secretOf(server) ?? []),
      );
      const serverRows: ServerRow[] = serverValues.map((server) => {
        const auth: ServerAuth = server.http?.auth.kind ?? "none";
        const secret = secretOf(server);
        return {
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          auth,
          secret,
          credential: secret === null
            ? null
            : states === null
            ? "unknown"
            : states.get(secret) ?? "missing",
        };
      });
      const view: SettingsView = {
        rows,
        revision: got.value.revision,
        defaultsRevision: got.value.defaults_revision,
        folders: Array.isArray(folders?.value) ? folders.value as string[] : [],
        servers: serverRows,
        rawServers: serverValues,
      };
      return { ok: true, value: view };
    },

    async addSkillFolder(view) {
      if (picker === undefined) return { ok: false, code: "unavailable" };
      const picked = await picker.pick();
      if (!picked.ok) return { ok: false, code: picked.code };
      if (picked.path === null) return { ok: true, value: null };
      if (view.folders.includes(picked.path)) {
        return { ok: true, value: { path: picked.path } };
      }
      const applied = await apply(view, SKILL_FOLDERS, [
        ...view.folders,
        picked.path,
      ]);
      return applied.ok ? { ok: true, value: { path: picked.path } } : applied;
    },

    addServer(view, server: NewServer) {
      const common = {
        name: server.name,
        revision: 1,
        enabled: true,
        call_timeout_ms: 60_000,
        classifications: {},
      };
      const secret = `sec:${secretNameOf(server.name)}`;
      const config = server.transport === "stdio"
        ? {
          ...common,
          transport: "stdio",
          stdio: {
            executable: server.executable,
            args: [...server.args],
            cwd: null,
            env: {},
          },
        }
        : {
          ...common,
          transport: "http",
          http: {
            url: server.url,
            headers: {},
            auth: server.auth === "none"
              ? { kind: "none" }
              : server.auth === "bearer"
              ? { kind: "bearer", secret_ref: secret }
              : {
                kind: "api_key",
                secret_ref: secret,
                header_name: server.header ?? "",
              },
          },
        };
      return apply(view, MCP_SERVERS, [...view.rawServers, config]);
    },

    enterServerCredential: (secret) =>
      openProtected({
        kind: "secret_input",
        owner: secret,
        purpose: "app_secret",
      }),
  };
}

/** MCP credential을 담는 보관 이름. 설정의 `sec:` 참조가 같은 이름을 가리킨다. */
export function secretNameOf(server: string): string {
  return `mcp-${server}`;
}
