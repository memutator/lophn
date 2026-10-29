// Coding agents 화면의 가짜 통로. main·core를 부르지 않고 부른 것을 기록한다.
import type {
  CodingConnectionsSource,
  HarnessHookView,
  HarnessName,
  HarnessSettingsView,
  SourceResult,
} from "../source.ts";

const LABELS: Record<HarnessName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "pi",
  omp: "Oh My Pi",
  cursor: "Cursor",
  copilot: "GitHub Copilot CLI",
  kimi: "Kimi Code",
  kiro: "Kiro CLI",
  antigravity: "Antigravity",
  grok: "Grok",
  droid: "Droid",
  amp: "Amp",
  devin: "Devin",
  qwen: "Qwen Code",
  qoder: "Qoder CLI",
  hermes: "Hermes",
  muse: "Muse",
  codebuddy: "CodeBuddy Code",
  "command-code": "Command Code",
  "prime-agent": "Prime Agent",
  mimocode: "MiMo Code",
  cline: "Cline",
  letta: "Letta Code",
  kilo: "Kilo Code CLI",
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
    can_deliver_messages: found,
    ...over,
  };
}

/** 화면 확인용 대표 감지 결과: 로그인 안 함, turn 끝 신호 없음, 못 찾음이 한 번씩 있다. */
const HARNESSES: readonly HarnessSettingsView[] = [
  harness("claude", { version: "2.1.4" }),
  harness("codex", { version: "0.58.0" }),
  harness("antigravity", {
    version: "0.9.2",
    can_deliver_messages: false,
  }),
  harness("opencode", { version: "1.4.0" }),
  harness("pi", {
    version: "0.7.1",
    can_deliver_messages: false,
  }),
  harness("hermes", { discovery: "absent" }),
];

/** 화면 확인용 hook 상태: 놓임, 안 놓임, 못 읽음, hook 없는 제품이 한 번씩 있다. */
const HOOKS: readonly HarnessHookView[] = [
  { harness_id: "claude", status: "installed", files: [] },
  { harness_id: "codex", status: "missing", files: ["~/.codex/hooks.json"] },
  { harness_id: "antigravity", status: "failed", files: [] },
  { harness_id: "opencode", status: "missing", files: [] },
  { harness_id: "pi", status: "unsupported", files: [] },
  { harness_id: "hermes", status: "unsupported", files: [] },
];

interface FakeConnectionsOptions {
  hooks?: SourceResult<readonly HarnessHookView[]>;
  harnesses?: SourceResult<readonly HarnessSettingsView[]>;
  refresh?: SourceResult<readonly HarnessSettingsView[]>;
}

interface FakeConnections {
  readonly source: CodingConnectionsSource;
  readonly calls: {
    harnesses: number;
    refresh: number;
    hookStatus: number;
    installed: HarnessName[];
    uninstalled: HarnessName[];
  };
}

export function fakeConnections(
  options: FakeConnectionsOptions = {},
): FakeConnections {
  const calls: FakeConnections["calls"] = {
    harnesses: 0,
    refresh: 0,
    hookStatus: 0,
    installed: [],
    uninstalled: [],
  };
  let hooks =
    options.hooks?.ok === false ? [] : [...(options.hooks?.value ?? HOOKS)];
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
    hookStatus() {
      calls.hookStatus += 1;
      return Promise.resolve(
        options.hooks?.ok === false
          ? options.hooks
          : { ok: true, value: hooks },
      );
    },
    installHooks(id) {
      calls.installed.push(id);
      const done: HarnessHookView = {
        harness_id: id,
        status: "installed",
        files: [],
      };
      hooks = hooks.map((hook) => (hook.harness_id === id ? done : hook));
      return Promise.resolve({ ok: true, value: done });
    },
    uninstallHooks(id) {
      calls.uninstalled.push(id);
      const done: HarnessHookView = {
        harness_id: id,
        status: "missing",
        files: [],
      };
      hooks = hooks.map((hook) => (hook.harness_id === id ? done : hook));
      return Promise.resolve({ ok: true, value: done });
    },
  };
  return { source, calls };
}
