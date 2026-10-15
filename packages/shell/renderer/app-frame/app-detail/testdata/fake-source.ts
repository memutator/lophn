// app-detail 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type {
  AccessView,
  ActivityRow,
  AppDecision,
  AppDetailSource,
  BlueprintView,
  Comparison,
  RuntimeView,
  SecretState,
  SourceResult,
  StartCheck,
  TaskChecks,
  TestResult,
  VersionList,
  VersionRow,
} from "../source.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
export const OTHER = "app_01h455vb4pex5v6nkc6gd5fd02";
export const REL_3 = "rel_01h455vb4pex5v6nkc6gd5fd03";
export const REL_4 = "rel_01h455vb4pex5v6nkc6gd5fd04";
export const REL_2 = "rel_01h455vb4pex5v6nkc6gd5fd02";
export const REL_5 = "rel_01h455vb4pex5v6nkc6gd5fd05";
export const TICKET = "tkt_01h455vb4pex5v6nkc6gd5fd01";
export const TEST_A = "vrf_01h455vb4pex5v6nkc6gd5fd01";
export const TEST_B = "vrf_01h455vb4pex5v6nkc6gd5fd02";

export const NOW = new Date("2026-10-07T12:00:00Z");
export const now = () => NOW;

export function version(
  id: string,
  number: number,
  status: VersionRow["status"],
  options: Partial<VersionRow> = {},
): VersionRow {
  return {
    id,
    number,
    status,
    createdAt: "2026-10-01T09:00:00Z",
    ticket: null,
    tests: [TEST_A],
    failure: null,
    dataFormat: 2,
    ...options,
  };
}

export const VERSIONS: VersionList = {
  current: REL_3,
  versions: [
    version(REL_4, 4, "prepared", { ticket: TICKET, tests: [TEST_B] }),
    version(REL_3, 3, "active", { tests: [TEST_A] }),
    version(REL_2, 2, "superseded"),
  ],
};

export const COMPARISON: Comparison = {
  previous: REL_3,
  addedPermissions: ["net.fetch:api.example.com:443"],
  removedPermissions: [],
  addedCommands: ["add_item"],
  removedCommands: [],
  changedCommands: [{ command: "list_items", kinds: ["effect"] }],
  externalCommands: ["send_report"],
  addedAutomations: [],
  removedAutomations: [],
  changedAutomations: [],
  addedScreens: ["settings"],
  removedScreens: [],
  changedScreens: [],
  dataFrom: 2,
  dataTo: 3,
  dataChanges: ["add the notes table"],
  reviewRequired: true,
};

export const BLUEPRINT: BlueprintView = {
  release: REL_3,
  commands: [
    { key: "list_items", label: "Show items" },
    { key: "send_report", label: "Send the weekly report" },
  ],
  automations: [
    {
      key: "weekly_report",
      label: "Weekly report",
      command: "send_report",
      when: { kind: "interval", intervalMs: 3_600_000 },
      external: true,
      inputHash: "a".repeat(64),
    },
    {
      key: "refresh",
      label: "Refresh items",
      command: "list_items",
      when: { kind: "on_start" },
      external: false,
      inputHash: "b".repeat(64),
    },
  ],
  fullScreen: "home",
  connections: [{ app: OTHER, commands: ["read_prices"] }],
};

export const ACCESS: AccessView = {
  grants: [
    {
      id: "grt_01h455vb4pex5v6nkc6gd5fd01",
      kind: "fs.read",
      active: true,
      exact: "/home/pat/Documents/budget/receipts",
      targetApp: null,
      commands: [],
      automation: null,
      inputHash: null,
    },
    {
      id: "grt_01h455vb4pex5v6nkc6gd5fd02",
      kind: "net.fetch",
      active: true,
      exact: "api.example.com:443",
      targetApp: null,
      commands: [],
      automation: null,
      inputHash: null,
    },
    {
      id: "grt_01h455vb4pex5v6nkc6gd5fd03",
      kind: "secret.use",
      active: true,
      exact: "BANK_TOKEN",
      targetApp: null,
      commands: [],
      automation: null,
      inputHash: null,
    },
    {
      id: "grt_01h455vb4pex5v6nkc6gd5fd04",
      kind: "fs.write",
      active: false,
      exact: "/home/pat/exports",
      targetApp: null,
      commands: [],
      automation: null,
      inputHash: null,
    },
  ],
  requirements: [
    {
      kind: "net.fetch",
      exact: "rates.example.org:443",
      reason: "Looks up exchange rates",
      granted: false,
    },
  ],
  warnings: ["permissions.warning.file-read-and-network"],
};

export function activity(
  id: string,
  options: Partial<ActivityRow> = {},
): ActivityRow {
  return {
    id,
    status: "succeeded",
    operation: { kind: "command", command: "list_items" },
    trigger: { kind: "direct" },
    mode: "live",
    caller: "direct",
    callerApp: null,
    at: "2026-10-07T11:50:00Z",
    ...options,
  };
}

export interface FakeOptions {
  versions?: VersionList;
  comparison?: Comparison;
  blueprint?: BlueprintView | null;
  access?: AccessView;
  runtime?: RuntimeView;
  secrets?: readonly SecretState[];
  activity?: readonly ActivityRow[];
  tests?: readonly TestResult[];
  task?: TaskChecks;
  start?: StartCheck | null;
  /** 이 이름의 읽기는 실패한다. */
  failing?: readonly string[];
  /** 결정 창이 열리지 않는다. */
  decideFails?: boolean;
  previewFails?: boolean;
  names?: Readonly<Record<string, string>>;
}

export function fakeDetail(options: FakeOptions = {}) {
  const calls: unknown[][] = [];
  // 결정 창이 확정 없이 끝났다고 알릴 때 부를 것들(창을 닫거나 취소한 경우).
  const unconfirmed: (() => void)[] = [];
  const failing = new Set(options.failing ?? []);
  const reply = <T>(name: string, value: T): Promise<SourceResult<T>> => {
    calls.push([name]);
    return Promise.resolve(
      failing.has(name)
        ? { ok: false, code: "unavailable" }
        : { ok: true, value },
    );
  };
  const source: AppDetailSource = {
    versions: () => reply("versions", options.versions ?? VERSIONS),
    compare: (release) => {
      calls.push(["compare-of", release]);
      return reply("compare", options.comparison ?? COMPARISON);
    },
    testResults: () =>
      reply(
        "testResults",
        options.tests ?? [{ id: TEST_A, result: "pass" as const }],
      ),
    taskChecks: () =>
      reply(
        "taskChecks",
        options.task ?? { reported: true, passed: 2, failed: 0, unclear: 0 },
      ),
    startCheck: () =>
      reply(
        "startCheck",
        options.start === undefined
          ? { release: REL_3, ready: true }
          : options.start,
      ),
    blueprint: () =>
      reply(
        "blueprint",
        options.blueprint === undefined ? BLUEPRINT : options.blueprint,
      ),
    access: () => reply("access", options.access ?? ACCESS),
    runtime: () =>
      reply(
        "runtime",
        options.runtime ?? { state: "running", terminationPending: false },
      ),
    secrets: () =>
      reply(
        "secrets",
        options.secrets ?? [{ name: "BANK_TOKEN", stored: true }],
      ),
    activity: () => reply("activity", options.activity ?? []),
    appName: (app) =>
      Promise.resolve(
        options.names?.[app] ?? (app === OTHER ? "Price tracker" : null),
      ),
    startPreview: (app, release) => {
      calls.push(["startPreview", app, release]);
      return Promise.resolve(
        options.previewFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: { nonce: "nonce-1" } },
      );
    },
    stopPreview: (app, preview) => {
      calls.push(["stopPreview", app, preview.nonce]);
      return Promise.resolve();
    },
    decide: (decision: AppDecision, onUnconfirmed) => {
      calls.push(["decide", decision]);
      if (onUnconfirmed !== undefined && !options.decideFails) {
        unconfirmed.push(onUnconfirmed);
      }
      return Promise.resolve(
        options.decideFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: true },
      );
    },
    turnOffAutomation: (grant) => {
      calls.push(["turnOff", grant]);
      return Promise.resolve({ ok: true, value: true });
    },
  };
  /** 열린 결정 창을 모두 거절·닫기로 끝낸다. */
  const endDecisions = () => {
    for (const end of unconfirmed.splice(0)) end();
  };
  return { source, calls, endDecisions };
}
