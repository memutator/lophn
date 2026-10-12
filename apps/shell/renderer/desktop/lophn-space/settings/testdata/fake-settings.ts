// settings 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. secret 값은 이
// 통로에 없다: 보호 창 열기는 이름만 기록한다.
import type {
  AccountRow,
  ProviderRow,
  ServerRow,
  SettingRow,
  SettingsSource,
  SettingsView,
  SourceResult,
} from "../source.ts";

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

export interface FakeSettingsOptions {
  settings?: Partial<SettingsView>;
  settingsFail?: boolean;
  /** 보호 창을 연 결과. 없으면 열린다. */
  windowCode?: string;
  /** OS 폴더 선택 결과. 없으면 이 경로를 고른다. */
  pickedFolder?: string | null;
  /** 설정 바꾸기 결과 code. 없으면 성공이다. */
  applyCode?: string;
  /** OAuth 로그인. begin이 실패하는 code, 끝나기를 기다리는 약속(없으면 바로 끝난다). */
  signIn?: {
    beginCode?: string;
    finish?: Promise<SourceResult<null>>;
  };
}

export function fakeSettings(options: FakeSettingsOptions = {}) {
  const calls: unknown[][] = [];
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
    beginSignIn(row) {
      calls.push(["sign-in-begin", row.name, row.signIn?.place ?? null]);
      return options.signIn?.beginCode
        ? failed(options.signIn.beginCode)
        : Promise.resolve({ ok: true, value: { callbackPort: 4321 } });
    },
    finishSignIn(row, callbackPort) {
      calls.push(["sign-in-finish", row.name, callbackPort]);
      return options.signIn?.finish ??
        Promise.resolve({ ok: true, value: null });
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
    signIn: null,
    ...options,
  };
}
