// 터미널마다 안에서 도는 coding agent를 따라가는 상태. 무엇이 도는지는 foreground process argv나
// hook이, 상태는 hook만 알린다. 화면 글자는 읽지 않는다. Electron도 protocol도 모르고 deps로만 일한다
// (shell tsc는 protocol의 base를 따라가지 못한다. 제품 표와 hook 신호 해석은 wiring이 넣는다).
import type { TerminalAgent, TerminalRuntime } from "../../../ipc/terminal.ts";

/** protocol `HookSignal` 가운데 이 module이 읽는 칸. */
export type AgentSignal = {
  type:
    | "SessionStarted"
    | "TurnStarted"
    | "TurnEnded"
    | "PermissionRequested"
    | "PermissionResolved"
    | "SessionEnded"
    | "SessionNamed";
  outcome?: "completed" | "failed" | "interrupted";
  /** TurnEnded가 payload로 받은 마지막 답이나 오류 글. */
  message?: string;
  request?: { tool: string | null; summary: string | null };
  /** hook이 알려 준 harness의 session id. */
  external_session?: string;
  /** TurnStarted가 payload로 받은 prompt 한 줄. */
  prompt?: string;
  /** harness가 hook으로 알려 준 session 이름. */
  name?: string;
};

export type AgentNotice = {
  terminal_ref: string;
  harness: string;
  kind: "finished" | "failed" | "permission";
  /** 알림 본문 재료: 마지막 답, 오류 글, 권한 물음의 요약. 모르면 없다. */
  body?: string;
};

export type AgentTrackerDeps = {
  /** foreground process argv가 어느 harness인지. */
  harnessOfProcess(argv: readonly string[]): string | null;
  /** 그 harness에서 사람이 치면 도는 turn을 끊는 키. */
  interruptKeys(harness: string): readonly ("escape" | "ctrl-c")[];
  signalOf(
    harness: string,
    event: string,
    payload: unknown,
  ): AgentSignal | null;
  /** 지금 알려진 터미널 runtime. 없으면 push할 것이 없다. */
  runtimeOf(terminalRef: string): TerminalRuntime | undefined;
  publish(runtime: TerminalRuntime): void;
  /** 사람이 그 탭을 보고 있다(그 탭을 고른 창에 OS focus가 있다). */
  looking(terminalRef: string): boolean;
  /** 알린다. 보고 있지 않아 알렸으면 true다(toast든 OS 알림이든 어디에 띄울지는 부르는 쪽이 정한다). */
  notify(notice: AgentNotice): boolean;
  /** 사람 터미널에서 foreground로 harness를 처음 알아봤다. 설치를 물을 때다. */
  identified?(harness: string, terminalRef: string): void;
  /** session id를 아는 터미널에서 hook이 왔다. 저장은 부르는 쪽이 정한다. */
  sessionSeen?(info: {
    terminal_ref: string;
    harness: string;
    session: string;
    title: string | null;
    name: string | null;
  }): void;
};

type Entry = {
  /** 마지막으로 본 foreground argv를 이어 붙인 것. */
  foreground: string | null;
  harness: string | null;
  /**
   * harness를 process(foreground)나 띄운 쪽이 정했다. 아니면 hook이 알려 준 것이라 다른 harness의 hook이
   * 오면 따라간다.
   */
  fixed: boolean;
  /** 이 harness의 hook을 한 번이라도 들었다. 아니면 상태는 unknown이다. */
  heard: boolean;
  /** 이 harness의 hook을 한 번이라도 들었다. 끊어서 heard가 내려가도 남는다. */
  hooked: boolean;
  /** hook이 알려 준 harness의 session id. */
  session: string | null;
  /** 그 session의 첫 prompt 한 줄. */
  title: string | null;
  /** harness가 hook으로 알려 준 session 이름. */
  name: string | null;
  running: boolean;
  /** 대기 중인 권한 물음 수. */
  waiting: number;
  unseen: boolean;
  /** 마지막으로 push한 agent 값(JSON, 없으면 "null"). 같으면 다시 push하지 않는다. */
  pushed: string;
};

const fresh = (
  harness: string | null,
  fixed: boolean,
): Pick<
  Entry,
  | "harness"
  | "fixed"
  | "heard"
  | "hooked"
  | "session"
  | "title"
  | "name"
  | "running"
  | "waiting"
  | "unseen"
> => ({
  harness,
  fixed,
  heard: false,
  hooked: false,
  session: null,
  title: null,
  name: null,
  running: false,
  waiting: 0,
  unseen: false,
});

function agentOf(entry: Entry): TerminalAgent | undefined {
  if (entry.harness === null) return undefined;
  const state =
    entry.waiting > 0
      ? "waiting"
      : !entry.heard
        ? "unknown"
        : entry.running
          ? "running"
          : "idle";
  return {
    harness: entry.harness,
    state,
    unseen: entry.unseen,
    hooked: entry.hooked,
    ...(entry.session === null ? {} : { session: entry.session }),
    ...(entry.title === null ? {} : { title: entry.title }),
    ...(entry.name === null ? {} : { name: entry.name }),
  };
}

export type AgentTracker = {
  foreground(terminalRef: string, argv: readonly string[] | null): void;
  hook(
    terminalRef: string,
    harness: string,
    event: string,
    payload: unknown,
  ): void;
  /** 사람이 친 입력. Esc·Ctrl-C로 도는 turn을 끊으면 상태를 모르게 둔다. */
  humanInput(terminalRef: string, text: string): void;
  /** 그 탭이 focus를 받았다. 못 본 것이 있었으면 지운다. */
  tabFocused(terminalRef: string): void;
  /** 창이 focus를 받았다. 이미 골라 둔 탭의 못 본 것을 지운다. */
  windowFocused(): void;
  /** 터미널이 끝났다. */
  gone(terminalRef: string): void;
  /** runtime에 지금의 agent를 싣는다. harness가 없으면 agent 칸이 없다. */
  decorate(runtime: TerminalRuntime): TerminalRuntime;
};

// Claude Code처럼 끊어도 Stop hook을 안 보내는 harness가 있어 사람이 친 key로 끊김을 본다.
const KEY_TEXT = { escape: "\x1b", "ctrl-c": "\x03" } as const;

export function createAgentTracker(deps: AgentTrackerDeps): AgentTracker {
  const entries = new Map<string, Entry>();

  function entryOf(ref: string): Entry {
    let entry = entries.get(ref);
    if (entry === undefined) {
      entry = { foreground: null, ...fresh(null, false), pushed: "null" };
      entries.set(ref, entry);
    }
    return entry;
  }

  // 끝났거나 모르는 터미널의 늦은 신호로 entry가 되살아나지 않게 한다.
  function alive(ref: string): boolean {
    const state = deps.runtimeOf(ref)?.state;
    return state !== undefined && state !== "exited" && state !== "unknown";
  }

  function push(ref: string, entry: Entry): void {
    const agent = agentOf(entry);
    const view = JSON.stringify(agent ?? null);
    if (view === entry.pushed) return;
    entry.pushed = view;
    const runtime = deps.runtimeOf(ref);
    if (runtime === undefined) return;
    deps.publish(decorate(runtime));
  }

  function decorate(runtime: TerminalRuntime): TerminalRuntime {
    const { agent: _stale, ...rest } = runtime;
    const entry = entries.get(runtime.terminal_ref);
    const agent = entry === undefined ? undefined : agentOf(entry);
    return agent === undefined ? rest : { ...rest, agent };
  }

  function notify(
    ref: string,
    entry: Entry,
    kind: AgentNotice["kind"],
    body?: string,
  ): void {
    if (entry.harness === null) return;
    // 보고 있으면 알릴 것이 없다.
    if (deps.looking(ref)) return;
    entry.unseen = deps.notify({
      terminal_ref: ref,
      harness: entry.harness,
      kind,
      body,
    });
  }

  return {
    foreground(ref, argv) {
      if (!alive(ref)) return;
      const entry = entryOf(ref);
      const joined = argv === null ? null : argv.join("\0");
      if (entry.foreground === joined) return;
      entry.foreground = joined;
      const harness = argv === null ? null : deps.harnessOfProcess(argv);
      if (harness !== null) {
        if (entry.harness !== harness) {
          Object.assign(entry, fresh(harness, true));
          deps.identified?.(harness, ref);
        } else {
          entry.fixed = true;
        }
      } else if (entry.harness !== null) {
        // 알아보지 못하는 process가 foreground가 됐다. agent는 떠났다.
        Object.assign(entry, fresh(null, false));
      }
      push(ref, entry);
    },
    hook(ref, harness, event, payload) {
      const signal = deps.signalOf(harness, event, payload);
      if (signal === null || !alive(ref)) return;
      const entry = entryOf(ref);
      // grok·devin·cursor는 ~/.claude/settings.json의 hook을 기본으로 같이 읽어 그 탭이 `lophn hook claude`를
      // 받는다. process가 정한 harness를 다른 harness의 hook이 뒤집지 못한다.
      if (entry.fixed && entry.harness !== harness) return;
      if (entry.harness !== harness) {
        Object.assign(entry, fresh(harness, false));
      }
      // 이름만 알리는 신호는 끊어서 내려간 heard나 첫 hook 전의 unknown을 되살리지 않는다.
      if (signal.type !== "SessionNamed") {
        entry.heard = true;
        entry.hooked = true;
      }
      // /clear나 resume은 같은 터미널에서 session을 바꾼다. 새 session의 제목은 새 prompt에서, 이름은 새 hook에서 다시 받는다.
      if (
        signal.external_session !== undefined &&
        signal.external_session !== entry.session
      ) {
        entry.session = signal.external_session;
        entry.title = null;
        entry.name = null;
      }
      if (signal.name !== undefined) entry.name = signal.name;
      switch (signal.type) {
        case "TurnStarted":
          if (entry.title === null && signal.prompt !== undefined) {
            entry.title = signal.prompt;
          }
          entry.running = true;
          entry.unseen = false;
          break;
        case "TurnEnded":
          entry.running = false;
          entry.waiting = 0;
          if (signal.outcome !== "interrupted") {
            notify(
              ref,
              entry,
              signal.outcome === "failed" ? "failed" : "finished",
              signal.message,
            );
          }
          break;
        case "PermissionRequested":
          entry.waiting += 1;
          notify(
            ref,
            entry,
            "permission",
            signal.request?.summary ?? signal.request?.tool ?? undefined,
          );
          break;
        case "PermissionResolved":
          // 한 물음을 두 event로 알리는 harness가 있어 하나씩 줄이면 센 수가 남아 waiting이 풀리지 않는다.
          entry.waiting = 0;
          break;
        case "SessionEnded":
          entry.running = false;
          entry.waiting = 0;
          entry.heard = false;
          break;
        case "SessionNamed":
          // 이름만 알리는 신호라 상태를 바꾸지 않는다.
          break;
      }
      push(ref, entry);
      if (entry.session !== null) {
        deps.sessionSeen?.({
          terminal_ref: ref,
          harness,
          session: entry.session,
          title: entry.title,
          name: entry.name,
        });
      }
    },
    humanInput(ref, text) {
      const entry = entries.get(ref);
      if (entry === undefined || entry.harness === null) return;
      if (
        !(entry.running || entry.waiting > 0) ||
        !deps.interruptKeys(entry.harness).some((key) => KEY_TEXT[key] === text)
      ) {
        return;
      }
      entry.running = false;
      entry.waiting = 0;
      entry.heard = false;
      push(ref, entry);
    },
    tabFocused(ref) {
      const entry = entries.get(ref);
      if (entry === undefined || !entry.unseen) return;
      entry.unseen = false;
      push(ref, entry);
    },
    windowFocused() {
      for (const [ref, entry] of entries) {
        if (entry.unseen && deps.looking(ref)) {
          entry.unseen = false;
          push(ref, entry);
        }
      }
    },
    gone(ref) {
      entries.delete(ref);
    },
    decorate(runtime) {
      return decorate(runtime);
    },
  };
}
