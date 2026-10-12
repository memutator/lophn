// coding agent 연결 화면 테스트의 가짜 통로. main·core를 부르지 않고 부른 것을 기록한다.
import type {
  AppChoice,
  CodingConnectionsSource,
  ConnectChoice,
  ConnectionRow,
  ConnectView,
  DetectView,
  HarnessName,
  HarnessView,
  SourceResult,
} from "../source.ts";

export const CAC_DESK = "cac_01h455vb4pex5v6nkc6gd5fd01";
export const CAC_OLD = "cac_01h455vb4pex5v6nkc6gd5fd02";
export const CAC_APP = "cac_01h455vb4pex5v6nkc6gd5fd03";
export const APP_BUDGET = "app_01h455vb4pex5v6nkc6gd5fd01";

export function harness(
  id: HarnessName,
  over: Partial<HarnessView> = {},
): HarnessView {
  const found = over.discovery === undefined || over.discovery === "detected";
  return {
    harness_id: id,
    discovery: "detected",
    version: found ? "1.2.3" : null,
    version_result: found ? "verified" : "unknown",
    auth: "not_verified",
    profile_id: null,
    observed_at: "2026-10-07T00:00:00.000Z",
    freshness: "fresh",
    executable: found ? `/usr/local/bin/${id}` : null,
    candidates: found ? [{ path: `/usr/local/bin/${id}`, source: "path" }] : [],
    probes: found ? [{ probe: "version", outcome: "ok" }] : [],
    ...over,
  };
}

export const DETECTED: DetectView = {
  source: "cached",
  harnesses: [
    harness("claude", { auth: "verified" }),
    harness("codex"),
    harness("opencode", { discovery: "absent" }),
    harness("gemini", { discovery: "error", version_result: "error" }),
    harness("hermes", { discovery: "absent" }),
    harness("pi", { discovery: "absent" }),
    harness("openclaw", { discovery: "unobserved" }),
  ],
};

export const CONNECTIONS: readonly ConnectionRow[] = [
  {
    id: CAC_DESK,
    label: "Desk Claude",
    scope: { kind: "all" },
    state: "active",
    revision: "7",
  },
  {
    id: CAC_APP,
    label: "Budget only",
    scope: { kind: "app", app: APP_BUDGET },
    state: "active",
    revision: "3",
  },
  {
    id: CAC_OLD,
    label: "Old laptop",
    scope: { kind: "all" },
    state: "revoked",
    revision: "9",
  },
];

export const APPS: readonly AppChoice[] = [
  { id: APP_BUDGET, name: "Grocery budget" },
  { id: "app_01h455vb4pex5v6nkc6gd5fd09", name: "Recipes" },
];

export const CONNECTED: ConnectView = {
  connection: CAC_DESK,
  install: {
    status: "complete",
    resources: [{ identity: "claude/mcp", outcome: "changed" }],
  },
  checks: [
    { stage: "mcp_initialize", result: "success" },
    { stage: "tool_discovery", result: "success" },
    { stage: "skill_discovery", result: "unknown" },
    { stage: "app_guide_loading", result: "failure" },
  ],
};

export interface FakeConnectionsOptions {
  detect?: SourceResult<DetectView>;
  refresh?: SourceResult<DetectView>;
  connections?: SourceResult<readonly ConnectionRow[]>;
  apps?: SourceResult<readonly AppChoice[]>;
  connect?: SourceResult<ConnectView>;
  revoke?: SourceResult<null>;
}

export interface FakeConnections {
  readonly source: CodingConnectionsSource;
  readonly calls: {
    detect: number;
    refresh: number;
    connections: number;
    connect: ConnectChoice[];
    revoke: string[];
  };
}

export function fakeConnections(
  options: FakeConnectionsOptions = {},
): FakeConnections {
  const calls: FakeConnections["calls"] = {
    detect: 0,
    refresh: 0,
    connections: 0,
    connect: [],
    revoke: [],
  };
  const source: CodingConnectionsSource = {
    watch: () => () => {},
    detect() {
      calls.detect += 1;
      return Promise.resolve(options.detect ?? { ok: true, value: DETECTED });
    },
    refresh() {
      calls.refresh += 1;
      return Promise.resolve(
        options.refresh ??
          { ok: true, value: { ...DETECTED, source: "refreshed" } },
      );
    },
    connections() {
      calls.connections += 1;
      return Promise.resolve(
        options.connections ?? { ok: true, value: CONNECTIONS },
      );
    },
    apps: () => Promise.resolve(options.apps ?? { ok: true, value: APPS }),
    connect(choice) {
      calls.connect.push(choice);
      return Promise.resolve(options.connect ?? { ok: true, value: CONNECTED });
    },
    revoke(connection) {
      calls.revoke.push(connection);
      return Promise.resolve(options.revoke ?? { ok: true, value: null });
    },
  };
  return { source, calls };
}
