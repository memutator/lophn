// settings 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. secret 값은 이
// 통로에 없다: 보호 창 열기는 이름만 기록한다.
import type {
  ServerRow,
  SettingEntry,
  SettingRejectReason,
  SettingsSource,
  SettingsUpdateResult,
  SettingsView,
  SourceResult,
} from "../source.ts";

/**
 * 선언한 설정 하나. 기본값을 주면 기본값이 있는 설정이고, 사람이 정한 값(chosen)을 주면 정한 설정이다.
 * 기본값도 정한 값도 없으면 사람이 골라야 하는 필수 설정이 비어 있는 모양이다.
 */
export function declared(
  key: string,
  type: Record<string, unknown>,
  options: { default?: unknown; chosen?: unknown } = {},
): SettingEntry {
  return {
    key,
    type,
    hasDefault: "default" in options,
    defaultValue: options.default,
    hasChosen: "chosen" in options,
    chosen: options.chosen,
  };
}

/** 화면 확인용 대표 선언: 불리언, 숫자 범위, 선택지, 목록이 한 번씩 있다. */
export const SAMPLE_DECLARED: readonly SettingEntry[] = [
  declared("agents.model.catalog_auto_update", { type: "boolean" }, {
    default: true,
    chosen: false,
  }),
  declared(
    "agents.run.max_tool_calls",
    { type: "integer", minimum: 1, maximum: 200 },
    { default: 50, chosen: 80 },
  ),
  declared(
    "agents.run.max_minutes",
    { type: "integer", minimum: 1, maximum: 120 },
    { default: 30 },
  ),
  declared(
    "agents.run.on_limit",
    { type: "string", enum: ["stop", "ask"] },
    { default: "stop" },
  ),
  declared(
    "projects.search.skip_patterns",
    { type: "array", items: { type: "string" } },
    { default: [], chosen: ["*.log", "dist/"] },
  ),
  declared("problems.detail_collection", { type: "boolean" }, {
    default: true,
  }),
];

interface FakeSettingsOptions {
  settings?: Partial<SettingsView>;
  settingsFail?: boolean;
  /** 선언한 설정. 없으면 대표 선언이다. */
  declared?: readonly SettingEntry[];
  /** 읽기가 실패하는지. */
  declaredFail?: boolean;
  /** 설정을 바꿀 때 거절되는 key와 이유. 거절되면 아무것도 저장하지 않는다. */
  rejects?: Readonly<Record<string, SettingRejectReason>>;
  /** 보호 창을 연 결과. 없으면 열린다. */
  windowCode?: string;
  /** OS 폴더 선택 결과. 없으면 이 경로를 고른다. */
  pickedFolder?: string | null;
  /** 설정 바꾸기 결과 code. 없으면 성공이다. */
  applyCode?: string;
  /**
   * OAuth 로그인. begin이 실패하는 code, 끝나기를 기다리는 약속(없으면 바로 끝난다).
   * 가짜는 core의 로그인 상태를 흉내 낸다: 시작하면 in_progress, 끝나면 signed_in, 그만두면 none이다.
   * stateStaysAfterFinish면 끝나도 상태가 none이다(core가 로그인하지 않았다고 말하는 경우).
   */
  signIn?: {
    beginCode?: string;
    finish?: Promise<SourceResult<null>>;
    stateStaysAfterFinish?: boolean;
  };
}

export function fakeSettings(options: FakeSettingsOptions = {}) {
  const calls: unknown[][] = [];
  let entries: readonly SettingEntry[] = options.declared ?? SAMPLE_DECLARED;
  const view: SettingsView = {
    folders: [],
    servers: [],
    rawServers: [],
    ...options.settings,
  };
  const failed = <T>(code: string): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: false, code });
  // core가 쥔 로그인 상태다. 화면은 이것을 settings()로만 읽는다.
  const states = new Map<
    string,
    Pick<NonNullable<ServerRow["signIn"]>, "state" | "reason">
  >();
  for (const row of view.servers) {
    if (row.signIn !== null) {
      states.set(row.name, {
        state: row.signIn.state,
        reason: row.signIn.reason,
      });
    }
  }
  let cancelWait: (result: SourceResult<null>) => void = () => {};
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
    declared() {
      calls.push(["declared"]);
      return options.declaredFail
        ? failed("unavailable")
        : Promise.resolve({ ok: true, value: entries });
    },
    update(changes) {
      calls.push(["update", changes]);
      const rejected = changes.flatMap((change) => {
        const reason = options.rejects?.[change.key];
        return reason === undefined ? [] : [{ key: change.key, reason }];
      });
      const result: SettingsUpdateResult = rejected.length > 0
        ? { changed: [], rejected }
        : { changed: changes.map((change) => change.key), rejected: [] };
      if (rejected.length === 0) {
        entries = entries.map((entry) => {
          const change = changes.find((one) => one.key === entry.key);
          if (change === undefined) return entry;
          return change.action === "set"
            ? { ...entry, hasChosen: true, chosen: change.value }
            : { ...entry, hasChosen: false, chosen: undefined };
        });
      }
      return Promise.resolve({ ok: true, value: result });
    },
    settings() {
      calls.push(["settings"]);
      return options.settingsFail ? failed("unavailable") : Promise.resolve({
        ok: true,
        value: {
          ...view,
          servers: view.servers.map((row) =>
            row.signIn === null ? row : {
              ...row,
              signIn: { ...row.signIn, ...states.get(row.name)! },
            }
          ),
        },
      });
    },
    addSkillFolder(current) {
      calls.push(["add-folder", current.folders]);
      const path = options.pickedFolder === undefined
        ? "/home/me/skills/notes"
        : options.pickedFolder;
      if (path === null) return Promise.resolve({ ok: true, value: null });
      if (options.applyCode) return failed(options.applyCode);
      return Promise.resolve({ ok: true, value: { path } });
    },
    addServer(current, server) {
      calls.push(["add-server", current.servers.length, server]);
      return options.applyCode
        ? failed(options.applyCode)
        : Promise.resolve({ ok: true, value: null });
    },
    enterServerCredential: (row) => opened(["server-credential", row.secret]),
    beginSignIn(row) {
      calls.push(["sign-in-begin", row.name, row.signIn?.place ?? null]);
      if (options.signIn?.beginCode) return failed(options.signIn.beginCode);
      states.set(row.name, { state: "in_progress", reason: null });
      return Promise.resolve({ ok: true, value: { callbackPort: 4321 } });
    },
    async finishSignIn(row, callbackPort) {
      calls.push(["sign-in-finish", row.name, callbackPort]);
      const cancelled = new Promise<SourceResult<null>>((resolve) => {
        cancelWait = resolve;
      });
      const result = await Promise.race([
        options.signIn?.finish ??
          Promise.resolve({ ok: true as const, value: null }),
        cancelled,
      ]);
      if (states.get(row.name)?.state === "none") return result;
      if (result.ok) {
        states.set(row.name, {
          state: options.signIn?.stateStaysAfterFinish ? "none" : "signed_in",
          reason: null,
        });
      } else {
        states.set(row.name, { state: "failed", reason: "exchange_failed" });
      }
      return result;
    },
    cancelSignIn(row) {
      calls.push(["sign-in-cancel", row.name, row.signIn?.place ?? null]);
      states.set(row.name, { state: "none", reason: null });
      cancelWait({ ok: false, code: "conflict" });
      return Promise.resolve({ ok: true, value: null });
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
