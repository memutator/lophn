// Coding agents 화면의 가짜 통로. main·core를 부르지 않고 부른 것을 기록한다.
import type {
  CodingConnectionsSource,
  CodingDefaults,
  HarnessName,
  HarnessSettingsView,
  SourceResult,
} from "../source.ts";

const LABELS: Record<HarnessName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  hermes: "Hermes",
  pi: "pi",
  openclaw: "OpenClaw",
};

function harness(
  id: HarnessName,
  over: Partial<HarnessSettingsView> = {},
): HarnessSettingsView {
  const found = over.discovery === undefined || over.discovery === "detected";
  return {
    harness_id: id,
    label: LABELS[id],
    discovery: "detected",
    version: found ? "1.2.3" : null,
    version_result: found ? "verified" : "unknown",
    login: "verified",
    can_launch: found,
    can_deliver_messages: found,
    reason: null,
    ...over,
  };
}

/** 화면 확인용 대표 감지 결과: 로그인 안 함, turn 끝 신호 없음, 맡길 수 없음, 못 찾음이 한 번씩 있다. */
const HARNESSES: readonly HarnessSettingsView[] = [
  harness("claude", { version: "2.1.4" }),
  harness("codex", { version: "0.58.0" }),
  harness("gemini", {
    version: "0.9.2",
    login: "not_verified",
    can_deliver_messages: false,
    reason: "This product doesn't report when a turn ends.",
  }),
  harness("opencode", { version: "1.4.0" }),
  harness("pi", {
    version: "0.7.1",
    can_launch: false,
    can_deliver_messages: false,
    reason:
      "The first prompt can't be passed on the command line or after the session starts.",
  }),
  harness("hermes", { discovery: "absent", login: "unknown" }),
];

interface FakeConnectionsOptions {
  harnesses?: SourceResult<readonly HarnessSettingsView[]>;
  refresh?: SourceResult<readonly HarnessSettingsView[]>;
  defaults?: SourceResult<CodingDefaults>;
  /** 저장이 거절되는 code. 없으면 저장된다. */
  saveCode?: string;
}

interface FakeConnections {
  readonly source: CodingConnectionsSource;
  readonly calls: {
    harnesses: number;
    refresh: number;
    saved: CodingDefaults[];
  };
}

export function fakeConnections(
  options: FakeConnectionsOptions = {},
): FakeConnections {
  const calls: FakeConnections["calls"] = {
    harnesses: 0,
    refresh: 0,
    saved: [],
  };
  let defaults: CodingDefaults = { harness: "claude", model: "" };
  const source: CodingConnectionsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    harnesses() {
      calls.harnesses += 1;
      return Promise.resolve(
        options.harnesses ?? { ok: true, value: HARNESSES },
      );
    },
    refresh() {
      calls.refresh += 1;
      return Promise.resolve(options.refresh ?? { ok: true, value: HARNESSES });
    },
    defaults() {
      return Promise.resolve(options.defaults ?? { ok: true, value: defaults });
    },
    saveDefaults(values) {
      calls.saved.push(values);
      if (options.saveCode) {
        return Promise.resolve({ ok: false, code: options.saveCode });
      }
      defaults = values;
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, calls };
}
