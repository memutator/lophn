// 터미널마다 안에서 도는 coding agent를 따라가는 상태. 무엇이 도는지는 foreground process argv나
// hook이, 상태는 hook만 알린다. 화면 글자는 읽지 않는다. 제품 표와 hook 신호 해석, 시각과 timer는 deps로 받는다
// (test가 표와 시간을 손으로 돌린다).
import { isAbsolute } from "node:path";

import type {
  TerminalAgent,
  TerminalRuntime,
} from "../../protocol/coding-agent/terminals.ts";
import { cleanAgentTitle } from "./agent-state.ts";
import { stripStatusGlyphs } from "./osc-title.ts";

/** protocol `HookSignal` 가운데 이 module이 읽는 칸. */
export type AgentSignal = {
  type:
    | "SessionStarted"
    | "TurnStarted"
    | "TurnEnded"
    | "PermissionRequested"
    | "PermissionResolved"
    | "SessionEnded"
    | "SessionNamed"
    | "ChildStarted"
    | "ChildEnded";
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
  /** ChildStarted·ChildEnded. harness 안에서 child(subagent)를 가르는 id. */
  child?: string;
  /** TurnEnded. 그 시점에 살아 있는 child의 전체 목록이다. 있으면(비어 있어도) child 집합을 이것으로 바꾼다. 없으면 집합을 그대로 둔다. */
  children?: readonly string[];
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
  /** foreground process argv가 resume하는 harness의 CLI session id. 모르면 null. */
  sessionOfProcess?(harness: string, argv: readonly string[]): string | null;
  /** foreground process argv에서 실행 파일·resume 인자를 뺀 CLI launch flag들. */
  launchArgsOfProcess?(harness: string, argv: readonly string[]): string[];
  /** 그 harness에서 사람이 치면 도는 turn을 끊는 키. */
  interruptKeys(harness: string): readonly ("escape" | "ctrl-c")[];
  signalOf(
    harness: string,
    event: string,
    payload: unknown,
  ): AgentSignal | null;
  /** 지금 알려진 터미널 runtime. 없으면 push할 것이 없다. */
  runtimeOf(terminalRef: string): TerminalRuntime | undefined;
  /** agent 값이 바뀐 runtime. 부르는 쪽이 그 agent를 터미널 runtime에 싣는다. */
  publish(runtime: TerminalRuntime): void;
  /** 지금 시각(ms). */
  now(): number;
  /** ms 뒤에 fn을 한 번 부르고, 부르는 것을 취소하는 함수를 돌려준다. */
  after(ms: number, fn: () => void): () => void;
  /** 알린다(`TerminalAgentSignaled`). 보고 있으면 띄우지 않는 것, toast든 OS 알림이든 어디에 띄울지는 shell main이 정한다. */
  notify(notice: AgentNotice): void;
  /**
   * attention에 계기를 넘긴다. 못 본 끝과 push는 attention이 정한다. `active_ms`는 turn이 running이 된
   * 때부터 끝까지에서 권한 물음을 기다린 시간을 뺀 것이고, 모르면(시작을 못 들었거나 waiting) null이다.
   */
  signal(info: {
    terminal_ref: string;
    harness: string;
    title: string | null;
    kind: "waiting" | "finished" | "failed";
    active_ms: number | null;
  }): void;
  /**
   * 그 터미널의 못 본 끝(`term:<탭>`)을 지운다. 새 turn이 시작했거나 터미널이 끝났다. attention은 터미널의 turn 시작과
   * 끝남을 모르므로 tracker가 알린다.
   */
  dismiss(terminalRef: string): void;
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
  /** session id를 처음 알게 됐다(foreground resume이나 hook). 저장본이 있으면 비어 있는 title·name을 채운다. */
  lookupSession?(info: {
    terminal_ref: string;
    harness: string;
    session: string;
  }): Promise<{
    title: string | null;
    name: string | null;
    pinned?: boolean;
    /** 외부 메타(예: agy summary DB)에서 새로 읽은 이름이라 session store에도 저장해야 한다. */
    persist?: boolean;
  } | null>;
};

type Entry = {
  /** 마지막으로 본 foreground argv를 이어 붙인 것. */
  foreground: string | null;
  /** 현재 foreground TUI의 argv. flag 보존(`--dangerously-skip-permissions`)에 쓴다. */
  argv: readonly string[] | null;
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
  /** 사람이 직접 이름을 고정했다. 이후 자동 이름·hook 이름이 덮어쓰지 않는다. */
  pinned: boolean;
  /** hook payload가 알려 준 harness의 작업 폴더. 탭의 TUI를 GUI로 넘길 때 쓴다. */
  cwd: string | null;
  running: boolean;
  /** 대기 중인 권한 물음 수. 0과 0 아님 사이를 오갈 때는 `setWaiting`으로 바꾼다(기다린 시간을 센다). */
  waiting: number;
  /** 이 turn이 running이 된 시각. 끝을 알리거나 끊기면 비운다. 시작을 못 들었으면 null이다. */
  startedAt: number | null;
  /** 이 turn에서 권한 물음을 기다린 시간의 합. 기다리는 동안은 기다리기 시작한 시각을 미리 뺀 값이다. */
  waited: number;
  /** main turn이 끝나도 도는 child(subagent)의 id → 그 child의 신호를 마지막으로 들은 시각. */
  children: Map<string, number>;
  /** main turn이 끝나 보낼 차례를 기다리는 알림. child가 남았거나 다시 running이면 아직 보내지 않는다. */
  pending: { kind: "finished" | "failed"; body?: string } | null;
  /** 가장 오래된 child가 timeout 날 때 깨는 timer. child가 없으면 없다. */
  sweepTimer: (() => void) | null;
  /** idle이 된 뒤 FINISH_DELAY_MS를 기다리는 알림 timer. */
  finishTimer: (() => void) | null;
  /** agy TurnEnded 뒤 summary DB의 늦은 쓰기를 한 번 더 읽는 timer. */
  titleTimer: (() => void) | null;
  /** agy에서 subagent/swarm 도구를 호출한 부모 conversationId. 이 터미널의 subagent hook을 걸러낸다. */
  subagentParent: string | null;
  /** agy idle Stop 뒤 부기용 PostToolUse를 다음 PreInvocation까지 무시한다. */
  ignorePostToolUntilTurn: boolean;
  /** 사람이 친 끊기 key로 내렸다. 끝 신호가 아니라 짐작이라, 뒤에 tool이 끝났다는 hook이 오면 되돌린다. */
  guessed: boolean;
  /** 이 터미널의 program이 마지막으로 낸 제목(상태 글리프를 뗀 것). agent가 오가도 터미널의 것이라 남는다. */
  screenTitle: string | null;
  /** 마지막으로 push한 agent 값(JSON, 없으면 "null"). 같으면 다시 push하지 않는다. */
  pushed: string;
};

const fresh = (
  harness: string | null,
  fixed: boolean,
): Pick<
  Entry,
  | "argv"
  | "harness"
  | "fixed"
  | "heard"
  | "hooked"
  | "session"
  | "title"
  | "name"
  | "pinned"
  | "cwd"
  | "running"
  | "waiting"
  | "startedAt"
  | "waited"
  | "subagentParent"
  | "ignorePostToolUntilTurn"
  | "guessed"
> => ({
  argv: null,
  harness,
  fixed,
  heard: false,
  hooked: false,
  session: null,
  title: null,
  name: null,
  pinned: false,
  cwd: null,
  running: false,
  waiting: 0,
  startedAt: null,
  waited: 0,
  subagentParent: null,
  ignorePostToolUntilTurn: false,
  guessed: false,
});

function agentOf(entry: Entry): TerminalAgent | undefined {
  if (entry.harness === null) return undefined;
  const state =
    entry.waiting > 0
      ? "waiting"
      : !entry.heard
        ? "unknown"
        : entry.running || entry.children.size > 0
          ? "running"
          : "idle";
  return {
    harness: entry.harness,
    state,
    hooked: entry.hooked,
    ...(entry.fixed ? { foreground: true as const } : {}),
    ...(entry.session === null ? {} : { session: entry.session }),
    ...(entry.title === null ? {} : { title: entry.title }),
    ...(entry.name === null ? {} : { name: entry.name }),
    ...(entry.screenTitle === null ? {} : { screen_title: entry.screenTitle }),
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
  /** 터미널의 program이 OSC로 낸 제목. agent가 있는 동안 runtime에 실려 모든 화면에 간다. */
  screenTitle(terminalRef: string, title: string): void;
  /** 사람이 친 입력. Esc·Ctrl-C로 도는 turn을 끊으면 상태를 모르게 둔다. */
  humanInput(terminalRef: string, text: string): void;
  /** 터미널이 끝났다. */
  gone(terminalRef: string): void;
  /**
   * PTY foreground에서 도는 harness TUI. hook만 들은 harness(GUI가 띄운 CLI)와 shell prompt는 null이다.
   * `session`은 TUI 자신의 session id, `cwd`는 hook이 알린 작업 폴더다.
   */
  tuiOf(terminalRef: string): {
    harness: string;
    state: TerminalAgent["state"];
    session: string | null;
    cwd: string | null;
    args: readonly string[];
  } | null;
  /** `terminals/open`의 `resume`이나 GUI→TUI 전환처럼 곧 뜰 TUI의 session id를 미리 알린다(argv에 인자가 없는 비 Linux 대비). */
  expectResume(terminalRef: string, harness: string, session: string): void;
  /** 사람이 저장된 session 이름을 고쳤다. 같은 session을 쥔 살아 있는 터미널에도 바로 반영한다. */
  renameSession(harness: string, session: string, name: string | null): void;
  /** foreground의 harness TUI가 떠났다(shell prompt나 다른 process). 돌려받은 함수로 그만 듣는다. */
  onForegroundExit(terminalRef: string, listener: () => void): () => void;
  /** tracker가 지금 아는 그 터미널의 PTY agent. 없으면 undefined다. */
  agentOf(terminalRef: string): TerminalAgent | undefined;
  /** runtime에 지금의 agent를 싣는다. harness가 없으면 agent 칸이 없다. */
  decorate(runtime: TerminalRuntime): TerminalRuntime;
};

// 시작 신호를 놓친 child가 SubagentStop도 못 받으면 영원히 running이라, 이 시간 동안 그 child의 신호가 없으면 뺀다.
const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
// 잠깐 idle이 됐다 바로 다시 running이 되는 turn(child 사이의 틈)에 finished를 울리지 않으려는 지연이다.
const FINISH_DELAY_MS = 1500;
// agy TurnEnded 뒤 conversation_summaries.db가 비동기로 쓰일 수 있어 잠시 뒤 한 번 더 읽는다.
const ANTIGRAVITY_TITLE_RECHECK_MS = 2000;
const ANTIGRAVITY_SUBAGENT_TOOLS: ReadonlySet<string> = new Set([
  "invoke_subagent",
  "send_message",
  "swarm",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function trimmedNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Claude Code처럼 끊어도 Stop hook을 안 보내는 harness가 있어 사람이 친 key로 끊김을 본다.
const KEY_TEXT = { escape: "\x1b", "ctrl-c": "\x03" } as const;

export function createAgentTracker(deps: AgentTrackerDeps): AgentTracker {
  const entries = new Map<string, Entry>();
  const exitListeners = new Map<string, Set<() => void>>();
  // terminals/open(resume)이나 GUI→TUI 전환이 곧 띄울 TUI의 session id(argv 인자가 없는 비 Linux 대비).
  const expectedResumes = new Map<
    string,
    { harness: string; session: string }
  >();

  function hydrate(ref: string, harness: string, session: string): void {
    if (deps.lookupSession === undefined) return;
    void deps
      .lookupSession({ terminal_ref: ref, harness, session })
      .then((saved) => {
        if (saved === null || !alive(ref)) return;
        const current = entries.get(ref);
        if (
          current === undefined ||
          current.harness !== harness ||
          current.session !== session
        ) {
          return;
        }
        let changed = false;
        let nameChanged = false;
        const savedTitle = cleanAgentTitle(saved.title, harness);
        if (current.title === null && savedTitle !== null) {
          current.title = savedTitle;
          changed = true;
        }
        if (saved.pinned === true) {
          current.pinned = true;
          const pinnedName = cleanAgentTitle(saved.name);
          if (pinnedName !== null && current.name !== pinnedName) {
            current.name = pinnedName;
            changed = true;
            nameChanged = true;
          }
        } else {
          const savedName = cleanAgentTitle(saved.name, harness);
          if (
            !current.pinned &&
            savedName !== null &&
            (current.name === null || saved.persist === true) &&
            current.name !== savedName
          ) {
            current.name = savedName;
            changed = true;
            nameChanged = true;
          }
        }
        if (changed) push(ref, current);
        if (nameChanged && saved.persist === true && current.session !== null) {
          deps.sessionSeen?.({
            terminal_ref: ref,
            harness,
            session: current.session,
            title: current.title,
            name: current.name,
          });
        }
      })
      .catch(() => {});
  }

  function setWaiting(entry: Entry, waiting: number): void {
    if (entry.waiting === 0 && waiting > 0) entry.waited -= deps.now();
    else if (entry.waiting > 0 && waiting === 0) entry.waited += deps.now();
    entry.waiting = waiting;
  }

  function tuiLeft(ref: string): void {
    for (const listener of [...(exitListeners.get(ref) ?? [])]) listener();
  }

  function entryOf(ref: string): Entry {
    let entry = entries.get(ref);
    if (entry === undefined) {
      entry = {
        foreground: null,
        ...fresh(null, false),
        children: new Map(),
        pending: null,
        sweepTimer: null,
        finishTimer: null,
        titleTimer: null,
        screenTitle: null,
        pushed: "null",
      };
      entries.set(ref, entry);
    }
    return entry;
  }

  function cancelTitleTimer(entry: Entry): void {
    entry.titleTimer?.();
    entry.titleTimer = null;
  }

  function scheduleAntigravityTitleRecheck(
    ref: string,
    entry: Entry,
    session: string,
  ): void {
    if (deps.lookupSession === undefined || entry.pinned) return;
    cancelTitleTimer(entry);
    entry.titleTimer = deps.after(ANTIGRAVITY_TITLE_RECHECK_MS, () => {
      entry.titleTimer = null;
      const current = entries.get(ref);
      if (
        current === undefined ||
        current.harness !== "antigravity" ||
        current.session !== session ||
        current.pinned ||
        !alive(ref)
      ) {
        return;
      }
      hydrate(ref, "antigravity", session);
    });
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
    return { ...rest, ...(agent === undefined ? {} : { agent }) };
  }

  // child 집합, 기다리는 알림과 그 timer를 모두 비운다.
  function drop(entry: Entry): void {
    entry.children.clear();
    entry.pending = null;
    entry.sweepTimer?.();
    entry.sweepTimer = null;
    entry.finishTimer?.();
    entry.finishTimer = null;
    cancelTitleTimer(entry);
  }

  // child 집합이 바뀌거나 main이 running이 아니게 된 뒤마다 부른다. 보이는 상태가 idle로 정해지면 알림을
  // 기다리게 하고, 다시 running·waiting이면 기다리던 알림을 취소한다.
  function reconcile(ref: string, entry: Entry): void {
    if (entry.children.size === 0) {
      entry.sweepTimer?.();
      entry.sweepTimer = null;
    } else if (entry.sweepTimer === null) {
      const oldest = Math.min(...entry.children.values());
      entry.sweepTimer = deps.after(
        Math.max(0, oldest + CHILD_TIMEOUT_MS - deps.now()),
        () => {
          entry.sweepTimer = null;
          const cutoff = deps.now() - CHILD_TIMEOUT_MS;
          for (const [id, seen] of entry.children) {
            if (seen <= cutoff) entry.children.delete(id);
          }
          reconcile(ref, entry);
          push(ref, entry);
        },
      );
    }
    const busy = entry.running || entry.waiting > 0 || entry.children.size > 0;
    if (busy) {
      if (entry.finishTimer !== null) {
        entry.finishTimer();
        entry.finishTimer = null;
      }
      return;
    }
    if (entry.pending === null || entry.finishTimer !== null) return;
    entry.finishTimer = deps.after(FINISH_DELAY_MS, () => {
      entry.finishTimer = null;
      const { pending } = entry;
      entry.pending = null;
      if (pending === null) return;
      notify(ref, entry, pending.kind, pending.body);
      push(ref, entry);
    });
  }

  function notify(
    ref: string,
    entry: Entry,
    kind: AgentNotice["kind"],
    body?: string,
  ): void {
    if (entry.harness === null) return;
    let active_ms: number | null = null;
    if (kind !== "permission") {
      active_ms =
        entry.startedAt === null
          ? null
          : Math.max(0, deps.now() - entry.startedAt - entry.waited);
      entry.startedAt = null;
      entry.waited = 0;
    }
    deps.signal({
      terminal_ref: ref,
      harness: entry.harness,
      title: entry.name ?? entry.title,
      kind: kind === "permission" ? "waiting" : kind,
      active_ms,
    });
    deps.notify({ terminal_ref: ref, harness: entry.harness, kind, body });
  }

  return {
    foreground(ref, argv) {
      if (!alive(ref)) return;
      const entry = entryOf(ref);
      const joined = argv === null ? null : argv.join("\0");
      if (entry.foreground === joined) return;
      entry.foreground = joined;
      const harness = argv === null ? null : deps.harnessOfProcess(argv);
      if (argv !== null && harness !== null) {
        if (entry.harness !== harness) {
          const prevHarness = entry.harness;
          drop(entry);
          Object.assign(entry, fresh(harness, true));
          // 직전이 다른 harness였으면 그 TUI가 낸 제목을 버린다. shell에서 뜰 때 TUI가 poll 직전에 낸 예비 제목은 유지한다.
          if (prevHarness !== null) entry.screenTitle = null;
          deps.identified?.(harness, ref);
        } else {
          entry.fixed = true;
        }
        entry.argv = argv;
        const fromArgv = deps.sessionOfProcess?.(harness, argv) ?? null;
        const expected = expectedResumes.get(ref);
        const seeded =
          expected?.harness === harness
            ? (expectedResumes.delete(ref), fromArgv ?? expected.session)
            : fromArgv;
        if (seeded !== null && seeded !== entry.session) {
          cancelTitleTimer(entry);
          entry.session = seeded;
          entry.title = null;
          entry.name = null;
          entry.pinned = false;
          entry.subagentParent = null;
          hydrate(ref, harness, seeded);
        }
      } else if (entry.harness !== null) {
        // 알아보지 못하는 process가 foreground가 됐다. agent는 떠났다.
        const wasTui = entry.fixed;
        drop(entry);
        Object.assign(entry, fresh(null, false));
        entry.screenTitle = null;
        push(ref, entry);
        if (wasTui) tuiLeft(ref);
        return;
      }
      push(ref, entry);
    },
    hook(ref, harness, event, payload) {
      if (!alive(ref)) return;
      if (harness === "antigravity") {
        const record = isRecord(payload) ? payload : null;
        const conversationId =
          nonEmptyString(record?.conversationId) ??
          nonEmptyString(record?.conversation_id) ??
          nonEmptyString(record?.session_id);
        const toolName =
          nonEmptyString(record?.tool_name) ?? nonEmptyString(record?.toolName);
        const lastUserInput =
          trimmedNonEmptyString(record?.lastUserInput) ??
          trimmedNonEmptyString(record?.last_user_input);
        const existing = entries.get(ref);
        if (
          existing !== undefined &&
          existing.fixed &&
          existing.harness !== harness
        ) {
          return;
        }
        // 규칙 ③: lastUserInput이 있는 새 conversationId는 사람이 새 대화를 연 것이므로 subagent 추적을 초기화한다.
        if (
          existing !== undefined &&
          existing.harness === harness &&
          existing.subagentParent !== null &&
          conversationId !== null &&
          conversationId !== existing.subagentParent &&
          lastUserInput !== null
        ) {
          existing.subagentParent = null;
          existing.children.clear();
        }
        // 규칙 ②: 같은 터미널에서 부모와 다른 conversationId이고 lastUserInput이 비어 있으면 subagent/swarm 워커 hook이다.
        // 부모의 자식 활동으로만 집계하고 메인 session·title·name·Recent(sessionSeen)는 절대 건드리지 않는다.
        if (
          existing !== undefined &&
          existing.harness === harness &&
          existing.subagentParent !== null &&
          conversationId !== null &&
          conversationId !== existing.subagentParent &&
          lastUserInput === null
        ) {
          if (
            event === "SessionStart" ||
            event === "PreInvocation" ||
            event === "PreToolUse" ||
            event === "PostToolUse"
          ) {
            existing.children.set(conversationId, deps.now());
            existing.heard = true;
            existing.hooked = true;
          } else if (event === "Stop" && record?.fullyIdle === true) {
            existing.children.delete(conversationId);
          }
          reconcile(ref, existing);
          push(ref, existing);
          return;
        }
        // idle Stop 확정 뒤 부기용 PostToolUse가 상태를 되살리거나 sessionSeen을 다시 부르지 못하게 다음 PreInvocation까지 무시한다.
        if (
          event === "PostToolUse" &&
          existing !== undefined &&
          existing.harness === harness &&
          existing.ignorePostToolUntilTurn
        ) {
          return;
        }
        // 규칙 ①: 부모가 subagent/swarm 도구를 부르면 현재 conversationId를 subagentParent로 고정한다.
        if (
          (event === "PreToolUse" || event === "PostToolUse") &&
          toolName !== null &&
          ANTIGRAVITY_SUBAGENT_TOOLS.has(toolName)
        ) {
          const entry = entryOf(ref);
          if (entry.harness !== harness) {
            drop(entry);
            Object.assign(entry, fresh(harness, false));
          }
          const parentId = conversationId ?? entry.session;
          if (parentId !== null) {
            entry.subagentParent = parentId;
          }
          // 질문 도구가 아닌 PreToolUse는 waiting으로 올리지 않는다.
          if (event === "PreToolUse") return;
        }
      }
      const signal = deps.signalOf(harness, event, payload);
      if (signal === null) return;
      const entry = entryOf(ref);
      // grok·devin·cursor는 ~/.claude/settings.json의 hook을 기본으로 같이 읽어 그 탭이 `lophn hook claude`를
      // 받는다. process가 정한 harness를 다른 harness의 hook이 뒤집지 못한다.
      if (entry.fixed && entry.harness !== harness) return;
      if (entry.harness !== harness) {
        drop(entry);
        Object.assign(entry, fresh(harness, false));
      }
      // 이름만 알리는 신호는 끊어서 내려간 heard나 첫 hook 전의 unknown을 되살리지 않는다.
      if (signal.type !== "SessionNamed") {
        entry.heard = true;
        entry.hooked = true;
      }
      // /clear나 resume은 같은 터미널에서 session을 바꾼다. 새 session의 제목은 새 prompt에서, 이름은 새 hook에서 다시 받는다.
      let acquiredSession: string | null = null;
      if (
        signal.external_session !== undefined &&
        signal.external_session !== entry.session
      ) {
        if (expectedResumes.get(ref)?.harness === harness) {
          expectedResumes.delete(ref);
        }
        cancelTitleTimer(entry);
        entry.session = signal.external_session;
        entry.title = null;
        entry.name = null;
        entry.pinned = false;
        entry.subagentParent = null;
        acquiredSession = signal.external_session;
      }
      if (signal.name !== undefined && !entry.pinned) {
        const cleanName = cleanAgentTitle(signal.name, harness);
        if (cleanName !== null) entry.name = cleanName;
      }
      const cwd = (payload as { cwd?: unknown } | null)?.cwd;
      if (typeof cwd === "string" && isAbsolute(cwd)) entry.cwd = cwd;
      switch (signal.type) {
        case "SessionStarted":
          drop(entry);
          entry.startedAt = null;
          entry.waited = 0;
          entry.ignorePostToolUntilTurn = false;
          break;
        case "TurnStarted": {
          entry.pending = null;
          entry.ignorePostToolUntilTurn = false;
          const cleanPrompt = cleanAgentTitle(signal.prompt, harness);
          if (entry.title === null && cleanPrompt !== null) {
            entry.title = cleanPrompt;
          }
          entry.running = true;
          // 끝 알림을 기다리던 중(child 사이의 틈)이면 같은 turn이 이어진다. 새 turn이면 앞 turn의 못 본 끝을 지운다.
          if (entry.startedAt === null) {
            entry.startedAt = deps.now();
            deps.dismiss(ref);
          }
          entry.guessed = false;
          break;
        }
        case "TurnEnded":
          entry.running = false;
          setWaiting(entry, 0);
          entry.guessed = false;
          if (harness === "antigravity") {
            entry.ignorePostToolUntilTurn = true;
          }
          // 목록은 전체 snapshot이다. 먼저 끝난 child의 id를 늦게 온 Stop이 되살려도 다음 Stop이 바로잡는다.
          if (signal.children !== undefined) {
            entry.children = new Map(
              signal.children.map((id) => [id, deps.now()]),
            );
          }
          entry.pending =
            signal.outcome === "interrupted"
              ? null
              : {
                  kind: signal.outcome === "failed" ? "failed" : "finished",
                  body: signal.message,
                };
          if (entry.pending === null) {
            entry.startedAt = null;
            entry.waited = 0;
          }
          break;
        case "PermissionRequested":
          setWaiting(entry, entry.waiting + 1);
          notify(
            ref,
            entry,
            "permission",
            signal.request?.summary ?? signal.request?.tool ?? undefined,
          );
          break;
        case "PermissionResolved":
        case "ChildStarted":
          // 한 물음을 두 event로 알리는 harness가 있어 하나씩 줄이면 센 수가 남아 waiting이 풀리지 않는다.
          // subagent의 권한 물음은 허락한 뒤 그 subagent의 tool hook(ChildStarted)이 와서 풀린다.
          setWaiting(entry, 0);
          if (signal.type === "ChildStarted" && signal.child !== undefined) {
            entry.children.set(signal.child, deps.now());
          }
          // 키로 내린 뒤에 tool이 끝났으면 turn은 안 끊긴 것이다(끊긴 tool은 이 hook을 내지 않는다).
          if (entry.guessed) {
            entry.guessed = false;
            entry.running = true;
          }
          break;
        case "ChildEnded":
          if (signal.child !== undefined) entry.children.delete(signal.child);
          break;
        case "SessionEnded":
          drop(entry);
          entry.running = false;
          entry.waiting = 0;
          entry.startedAt = null;
          entry.waited = 0;
          entry.guessed = false;
          entry.heard = false;
          entry.ignorePostToolUntilTurn = false;
          break;
        case "SessionNamed":
          // 이름만 알리는 신호라 상태를 바꾸지 않는다.
          break;
      }
      reconcile(ref, entry);
      push(ref, entry);
      if (acquiredSession !== null) {
        hydrate(ref, harness, acquiredSession);
      } else if (
        entry.session !== null &&
        entry.name === null &&
        (signal.type === "TurnStarted" || signal.type === "TurnEnded")
      ) {
        hydrate(ref, harness, entry.session);
      }
      if (
        harness === "antigravity" &&
        signal.type === "TurnEnded" &&
        entry.session !== null
      ) {
        scheduleAntigravityTitleRecheck(ref, entry, entry.session);
      }
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
    screenTitle(ref, title) {
      if (!alive(ref)) return;
      const entry = entryOf(ref);
      // spinner 프레임만 바뀐 제목은 같은 이름이라 다시 알리지 않는다.
      const name = stripStatusGlyphs(title);
      // shell이 foreground일 때 상태 글리프 없이 온 제목은 shell prompt(예: user@host: ~/path)다.
      // OSC 제목을 내지 않는 TUI(agy 등)가 이어서 뜰 때 그 shell 제목이 agent 제목을 덮지 않게 버린다.
      // TUI가 foreground poll 직전에 상태 글리프(`✳` 등)와 함께 낸 첫 제목만 예비로 남긴다.
      if (entry.harness === null && name === title.trim()) {
        entry.screenTitle = null;
        return;
      }
      if (entry.screenTitle === name) return;
      entry.screenTitle = name;
      push(ref, entry);
    },
    humanInput(ref, text) {
      const entry = entries.get(ref);
      if (entry === undefined || entry.harness === null) return;
      if (
        !(entry.running || entry.waiting > 0 || entry.children.size > 0) ||
        !deps.interruptKeys(entry.harness).some((key) => KEY_TEXT[key] === text)
      ) {
        return;
      }
      drop(entry);
      entry.running = false;
      setWaiting(entry, 0);
      entry.heard = false;
      entry.guessed = true;
      push(ref, entry);
    },
    gone(ref) {
      expectedResumes.delete(ref);
      const entry = entries.get(ref);
      if (entry === undefined) return;
      const wasTui = entry.fixed && entry.harness !== null;
      drop(entry);
      entries.delete(ref);
      deps.dismiss(ref);
      if (wasTui) tuiLeft(ref);
      exitListeners.delete(ref);
      // agent를 알린 적이 있으면 agent가 빠진 runtime을 낸다. 안 그러면 화면의 Finished 줄이 끝난 터미널에 남는다.
      if (entry.pushed === "null") return;
      const runtime = deps.runtimeOf(ref);
      if (runtime !== undefined) deps.publish(decorate(runtime));
    },
    agentOf(ref) {
      const entry = entries.get(ref);
      return entry === undefined ? undefined : agentOf(entry);
    },
    decorate(runtime) {
      return decorate(runtime);
    },
    tuiOf(ref) {
      const entry = entries.get(ref);
      const agent = entry === undefined ? undefined : agentOf(entry);
      if (entry === undefined || !entry.fixed || agent === undefined) {
        return null;
      }
      return {
        harness: agent.harness,
        state: agent.state,
        session: entry.session,
        cwd: entry.cwd,
        args:
          entry.argv === null
            ? []
            : (deps.launchArgsOfProcess?.(agent.harness, entry.argv) ?? []),
      };
    },
    expectResume(ref, harness, session) {
      if (!alive(ref)) return;
      expectedResumes.set(ref, { harness, session });
    },
    renameSession(harness, session, name) {
      for (const [ref, entry] of entries) {
        if (entry.harness !== harness || entry.session !== session) continue;
        const nextPinned = name !== null;
        if (entry.name === name && entry.pinned === nextPinned) continue;
        entry.name = name;
        entry.pinned = nextPinned;
        push(ref, entry);
      }
    },
    onForegroundExit(ref, listener) {
      let set = exitListeners.get(ref);
      if (set === undefined) {
        set = new Set();
        exitListeners.set(ref, set);
      }
      set.add(listener);
      return () => void exitListeners.get(ref)?.delete(listener);
    },
  };
}
