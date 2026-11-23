// harness-gui 입구. 터미널 탭의 `<harness> gui`(`onTab.gui`), 터미널 없는 background 실행(`terminal: null`),
// GUI ↔ TUI toggle(`onTab.tui`)을 받아 harness의 adapter로 ACP session 하나를 연다.
// 어느 process를 끄고 띄우는지는 adapter의 `handoff`가 정한다(`adapter.ts`의 toggle 흐름). 이 file이 그 순서를 지킨다.
import type { Clock } from "../../base/clock.ts";
import type { IdSource } from "../../base/id.ts";
import type {
  AcpSessionHandle,
  AcpTabRequest,
  AcpTerminal,
  CliSpawn,
  ExtensionAcp,
} from "../../protocol/acp/mod.ts";
import { redactCredentials } from "../../base/telemetry/log.ts";
import {
  HARNESS_GUI_ADAPTERS,
  type HarnessGuiAdapter,
  type HarnessGuiCarry,
  type HarnessGuiRun,
  type HarnessRuntimeAdapter,
} from "./adapter.ts";
import { receivedSends } from "./received.ts";

export {
  HARNESS_GUI_ADAPTERS,
  type HarnessGuiAdapter,
  type HarnessGuiCarry,
  type HarnessGuiRun,
  type HarnessRuntimeAdapter,
};

export type HarnessGuiDeps = {
  acp: ExtensionAcp;
  spawn: CliSpawn;
  clock: Clock;
  ids: IdSource;
};

// TUI를 끄는 데 걸리는 시간의 상한. SIGKILL은 보내지 않는다(대화 기록을 덜 쓴 채 끊지 않는다).
const EXIT_WAIT_MS = 5000;
// GUI → TUI에서 CLI의 `stop()`을 기다리는 시간의 상한.
const STOP_WAIT_MS = 8000;

const EXIT_TIMEOUT = {
  code: "unavailable",
  message: "The coding agent did not exit in 5 seconds.",
} as const;

function within<T>(ms: number, work: Promise<T>, otherwise: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(otherwise), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(otherwise);
      },
    );
  });
}

/** 실행 중인 ACP handle 하나(탭 GUI 또는 background). `run`은 adapter가 시작을 마친 뒤에야 있다. */
type Tab = {
  terminal: AcpTerminal | null;
  adapter: HarnessGuiAdapter;
  session: AcpSessionHandle;
  run: HarnessGuiRun | null;
  closed: boolean;
  /** shared run이 마지막으로 본 CLI session id. 바뀌면 TUI client를 새 id로 다시 붙인다. */
  seen: string | null;
};

export function startHarnessGui(ctx: HarnessGuiDeps): () => void {
  const tabs = new Map<string, Tab>();
  // key(terminal id 또는 background key) → 끝난 run이 넘긴 값. handle은 toggle과 resume마다 새로 열리므로 key에 둔다. 작은 값이라 닫혀도 남긴다.
  const carried = new Map<string, HarnessGuiCarry>();
  const keepCarry = (key: string, run: HarnessGuiRun | null) => {
    const carry = run?.carry?.();
    if (carry !== undefined) carried.set(key, carry);
  };

  // env는 (spawn이 얹는 login shell) < 탭의 hook env < 요청 env(background 자격·session) < adapter가 바꾸는 칸 순서다.
  // 탭의 hook env 덕에 GUI가 띄운 CLI의 hook도 같은 탭으로 와서 GUI turn 동안에도 탭의 상태 점이 맞는다.
  const spawnFor =
    (
      terminal: AcpTerminal | null,
      extraEnv?: Readonly<Record<string, string>>,
    ): CliSpawn =>
    (command, args, options) =>
      ctx.spawn(command, args, {
        ...options,
        env: { ...terminal?.env, ...extraEnv, ...options?.env },
      });

  function fail(
    session: AcpSessionHandle,
    error: { code: string; message: string },
  ) {
    // handle은 열어 두고 오류를 끝난 turn으로 보인다. 닫는 것(TUI로 돌아가기나 background 정리)은 부른 쪽이다.
    session.publish({
      type: "turn_ended",
      turn: ctx.ids.newId("trn"),
      at: ctx.clock.now(),
      outcome: "failed",
      active_ms: null,
      error,
      messages: [],
      seq: 1,
    });
  }

  function exited(terminal: AcpTerminal): Promise<boolean> {
    return new Promise((resolve) => {
      let off: (() => void) | undefined;
      const timer = setTimeout(() => {
        off?.();
        resolve(false);
      }, EXIT_WAIT_MS);
      off = terminal.onForegroundExit(() => {
        clearTimeout(timer);
        off?.();
        resolve(true);
      });
      // 이미 shell이면 떠남을 기다릴 필요가 없다.
      if (terminal.state() === "shell") {
        clearTimeout(timer);
        off();
        resolve(true);
      }
    });
  }

  // shared run에서 CLI session id가 바뀌면(GUI의 fork, `/new`, fork하는 rewind) 그 server에 붙은 TUI client는 옛 session을
  // 본다. client만 끄고 새 id로 붙는 명령을 다시 친다. server와 turn은 그대로 돈다. client가 없으면 다음 toggle이 새 명령을 친다.
  async function followSession(tab: Tab): Promise<void> {
    const { run, terminal } = tab;
    if (terminal === null) return;
    const id = run?.sessionId() ?? null;
    if (run === null || id === null || id === tab.seen) return;
    const first = tab.seen === null;
    tab.seen = id;
    if (first || terminal.state() === "shell") return;
    terminal.signal("SIGTERM");
    if (await exited(terminal)) terminal.type(`${run.tuiCommand()}\r`);
  }

  async function gui(request: AcpTabRequest): Promise<void> {
    const { terminal, harness } = request;
    const key = request.key ?? terminal?.id;
    const cwd = request.cwd ?? terminal?.cwd;
    if (key === undefined || cwd === undefined) {
      throw new Error("background harness request needs key and cwd");
    }
    const adapter = HARNESS_GUI_ADAPTERS[harness];
    const session = ctx.acp.open({
      terminal,
      ...(request.key === undefined ? {} : { key: request.key }),
      harness,
      title: harness,
      handoff: adapter.handoff,
    });
    const tab: Tab = {
      terminal,
      adapter,
      session,
      run: null,
      closed: false,
      seen: request.resume ?? null,
    };
    tabs.set(key, tab);
    session.onClose(() => {
      tab.closed = true;
      if (tabs.get(key) === tab) tabs.delete(key);
      const run = tab.run;
      tab.run = null;
      keepCarry(key, run);
      // 닫힌 handle이라 오류를 보일 곳이 없다.
      run?.stop().catch(() => {});
    });

    try {
      // TUI가 foreground에 있으면(TUI → GUI) 먼저 끈다. 한 session을 두 process가 같이 쓰지 않는다.
      // tracker가 TUI를 떠나면 session id를 잊으므로 `resume`은 요청이 이미 들고 있다.
      if (terminal !== null && terminal.state() !== "shell") {
        const ended = await within(EXIT_WAIT_MS, adapter.exitTui(terminal), {
          ok: false as const,
          error: EXIT_TIMEOUT,
        });
        if (!ended.ok) return fail(session, ended.error);
        if (!(await exited(terminal))) return fail(session, EXIT_TIMEOUT);
      }
      if (tab.closed) return;

      const carry = carried.get(key);
      const started = await adapter.start({
        terminal,
        cwd,
        ...(request.resume === undefined ? {} : { resume: request.resume }),
        ...(request.forkFrom === undefined
          ? {}
          : { forkFrom: request.forkFrom }),
        ...(request.args === undefined ? {} : { args: request.args }),
        ...(carry === undefined ? {} : { carry }),
        ...(request.launch === undefined ? {} : { launch: request.launch }),
        ...(request.member === undefined ? {} : { member: request.member }),
        session: receivedSends({
          ...session,
          publish(update) {
            session.publish(update);
            if (adapter.handoff === "shared" && terminal !== null)
              void followSession(tab).catch(() => {});
          },
        }),
        spawn: spawnFor(terminal, request.env),
        clock: ctx.clock,
        ids: ctx.ids,
      });
      if (!started.ok) return fail(session, started.error);
      // 시작하는 동안 handle이 닫혔다.
      if (tab.closed) return void started.value.stop().catch(() => {});
      tab.run = started.value;
      tab.seen = started.value.sessionId() ?? tab.seen;
    } catch (cause) {
      // adapter가 던진 것은 예상하지 못한 것이다. handle을 빈 GUI로 두지 않고 turn 오류로 보인다.
      fail(session, {
        code: "internal",
        message: redactCredentials(
          cause instanceof Error ? cause.message : String(cause),
        ),
      });
    }
  }

  async function tui(terminalId: string): Promise<void> {
    const tab = tabs.get(terminalId);
    if (tab === undefined || tab.terminal === null) return;
    const { run, terminal } = tab;
    if (tab.adapter.handoff === "restart") {
      // CLI가 끝난 뒤에야 handle을 닫고 같은 session을 TUI로 잇는다.
      tab.run = null;
      keepCarry(terminalId, run);
      let command: string | undefined;
      if (run !== null) {
        // 앞 process가 끝났는지 모르면 TUI를 띄우지 않는다(같은 session을 둘이 쓰지 않는다).
        let rejected: unknown;
        const stopped = await within(
          STOP_WAIT_MS,
          run.stop().then(
            () => true,
            (cause) => {
              rejected = cause ?? "stop failed";
              return false;
            },
          ),
          false,
        );
        if (!stopped) {
          tab.session.close();
          throw new Error(
            rejected === undefined
              ? "The coding agent did not stop in 8 seconds, so the terminal view was not started."
              : redactCredentials(
                  rejected instanceof Error
                    ? rejected.message
                    : String(rejected),
                ),
          );
        }
        command = run.tuiCommand();
      }
      tab.session.close();
      if (command !== undefined && terminal.state() === "shell") {
        terminal.type(`${command}\r`);
      }
      return;
    }
    // shared: TUI client가 이미 foreground에 있으면 화면만 바뀐다. handle과 server는 그대로다.
    if (run !== null && terminal.state() === "shell") {
      terminal.type(`${run.tuiCommand()}\r`);
    }
  }

  const running = (terminalId: string) =>
    tabs.get(terminalId)?.run?.running() ?? null;
  const sessions = async (terminalId: string) =>
    (await tabs.get(terminalId)?.run?.sessions?.()) ?? [];
  const rewindPreview = async (terminalId: string, message: string) =>
    (await tabs.get(terminalId)?.run?.rewindPreview?.(message)) ?? null;
  const offTab = ctx.acp.onTab({
    gui,
    tui,
    running,
    sessions,
    rewindPreview,
  });
  return () => {
    offTab();
    for (const tab of [...tabs.values()]) tab.session.close();
  };
}
