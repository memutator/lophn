// settings 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. secret 값은 이
// 통로에 없다: 보호 창 열기는 이름만 기록한다.
import type {
  AccountRow,
  ModelDefaults,
  ProviderRow,
  ServerRow,
  SettingRow,
  SettingsSource,
  SettingsView,
  SignIn,
  SourceResult,
  TestResult,
  UsageRow,
} from "../source.ts";

export const CLAUDE = "pvd_01h455vb4pex5v6nkc6gd5fd01";
export const CHATGPT = "pvd_01h455vb4pex5v6nkc6gd5fd02";
export const LOCAL = "pvd_01h455vb4pex5v6nkc6gd5fd03";

export function account(
  key: string,
  label: string,
  options: Partial<Omit<AccountRow, "key" | "label">> = {},
): AccountRow {
  return {
    key,
    label,
    way: "api_key",
    enabled: true,
    order: 0,
    account: null,
    organization: null,
    plan: null,
    state: "available",
    reason: null,
    until: null,
    modelBlocks: [],
    ...options,
  };
}

export function provider(
  id: string,
  name: string,
  options: Partial<Omit<ProviderRow, "id" | "name">> = {},
): ProviderRow {
  return {
    id,
    registered: true,
    name,
    enabled: true,
    definition: `${name.toLowerCase()}-def`,
    ways: ["api_key"],
    signIn: null,
    local: false,
    accounts: [],
    lastCheck: null,
    revision: 4,
    ...options,
  };
}

export function setting(
  key: string,
  title: string,
  value: unknown,
  options: Partial<Omit<SettingRow, "key" | "title" | "value">> = {},
): SettingRow {
  return {
    key,
    title,
    value,
    resolved: true,
    changed: false,
    defaultValue: value,
    hasDefault: true,
    applyAt: "next_run",
    ...options,
  };
}

export const NO_USAGE: UsageRow = { calls: 0, costs: [], complete: true };

export interface FakeSettingsOptions {
  providers?: readonly ProviderRow[];
  providersFail?: boolean;
  usage?: Readonly<Record<string, UsageRow>>;
  usageFail?: boolean;
  /** definition → model names. 없으면 읽지 못한다. */
  models?: Readonly<Record<string, readonly string[]>>;
  /** 연결 테스트 결과 code. 없으면 두 종류 모두 성공이다. */
  testCode?: string;
  testResults?: readonly TestResult[];
  /** 로그인 시작 결과. */
  signIn?: SignIn | { readonly code: string };
  /** 공식 로그인 주소를 연 결과. */
  linkOpens?: boolean;
  defaults?: ModelDefaults;
  settings?: Partial<SettingsView>;
  settingsFail?: boolean;
  /** 보호 창을 연 결과. 없으면 열린다. */
  windowCode?: string;
  /** OS 폴더 선택 결과. 없으면 이 경로를 고른다. */
  pickedFolder?: string | null;
  /** 설정 바꾸기 결과 code. 없으면 성공이다. */
  applyCode?: string;
  setDefaultCode?: string;
  /** 앱 export 결과 code. 없으면 ready다. */
  exportCode?: string;
}

export const EMPTY_DEFAULTS: ModelDefaults = {
  decisions: null,
  summaries: null,
  seq: "9",
};

export function fakeSettings(options: FakeSettingsOptions = {}) {
  const calls: unknown[][] = [];
  let defaults = options.defaults ?? EMPTY_DEFAULTS;
  const view: SettingsView = {
    rows: [],
    revision: 3,
    defaultsRevision: "d1",
    folders: [],
    servers: [],
    rawServers: [],
    ...options.settings,
  };
  const failed = <T>(code: string): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: false, code });
  const opened = (call: unknown[]) => {
    calls.push(call);
    return Promise.resolve(
      options.windowCode
        ? { ok: false as const, code: options.windowCode }
        : { ok: true as const, value: null },
    );
  };
  const source: SettingsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    providers() {
      calls.push(["providers"]);
      return options.providersFail
        ? failed("unavailable")
        : Promise.resolve({ ok: true, value: options.providers ?? [] });
    },
    usage(account) {
      calls.push(["usage", account]);
      if (options.usageFail) return failed("unavailable");
      return Promise.resolve({
        ok: true,
        value: options.usage?.[account] ?? NO_USAGE,
      });
    },
    models(definition) {
      calls.push(["models", definition]);
      const names = options.models?.[definition];
      return names === undefined
        ? failed("unavailable")
        : Promise.resolve({ ok: true, value: names });
    },
    testConnection(input) {
      calls.push(["test", input.provider, input.account, input.model]);
      if (options.testCode) return failed(options.testCode);
      return Promise.resolve({
        ok: true,
        value: options.testResults ?? [
          { kind: "text", result: "success", timeoutSeconds: 30 },
          { kind: "tool_call", result: "success", timeoutSeconds: 30 },
        ],
      });
    },
    beginSignIn(id) {
      calls.push(["begin-sign-in", id]);
      const found = options.signIn;
      if (found === undefined) return failed("not_found");
      return !("login" in found)
        ? failed(found.code)
        : Promise.resolve({ ok: true, value: found });
    },
    cancelSignIn(id, login) {
      calls.push(["cancel-sign-in", id, login]);
      return Promise.resolve({ ok: true, value: null });
    },
    openLink(url) {
      calls.push(["open-link", url]);
      return Promise.resolve(options.linkOpens ?? true);
    },
    connectKey: (id, label) => opened(["connect-key", id, label]),
    enterSignInResponse: (id, label) => opened(["sign-in-response", id, label]),
    replaceKey: (id, key) => opened(["replace-key", id, key]),
    removeAccount: (id, key) => opened(["remove-account", id, key]),
    modelDefaults() {
      calls.push(["model-defaults"]);
      return Promise.resolve({ ok: true, value: defaults });
    },
    setModelDefault(use, pick, was) {
      calls.push(["set-default", use, pick.provider, pick.model, [
        ...pick.accounts,
      ], was.seq]);
      if (options.setDefaultCode) return failed(options.setDefaultCode);
      const choice = { provider: pick.provider, model: pick.model };
      defaults = {
        ...defaults,
        [use]: choice,
        seq: String(Number(defaults.seq) + 1),
      };
      return Promise.resolve({ ok: true, value: defaults });
    },
    settings() {
      calls.push(["settings"]);
      return options.settingsFail
        ? failed("unavailable")
        : Promise.resolve({ ok: true, value: view });
    },
    addSkillFolder(current) {
      calls.push(["add-folder", current.revision]);
      const path = options.pickedFolder === undefined
        ? "/home/me/skills/notes"
        : options.pickedFolder;
      if (path === null) return Promise.resolve({ ok: true, value: null });
      if (options.applyCode) return failed(options.applyCode);
      return Promise.resolve({ ok: true, value: { path } });
    },
    addServer(current, server) {
      calls.push(["add-server", current.revision, server]);
      return options.applyCode
        ? failed(options.applyCode)
        : Promise.resolve({ ok: true, value: null });
    },
    enterServerCredential: (secret) => opened(["server-credential", secret]),
    exportApp(app) {
      calls.push(["export-app", app]);
      if (options.exportCode) {
        return Promise.resolve({
          ok: false as const,
          code: options.exportCode,
        });
      }
      return Promise.resolve({
        ok: true as const,
        value: {
          app,
          state: "ready" as const,
          includesExternalData: false,
        },
      });
    },
  };
  return { source, calls };
}

export function server(
  name: string,
  options: Partial<Omit<ServerRow, "name">> = {},
): ServerRow {
  return {
    name,
    transport: "http",
    enabled: true,
    auth: "none",
    secret: null,
    credential: null,
    ...options,
  };
}
