// extension 입구. 터미널 탭의 `<harness> gui`(`onTab.gui`)와 GUI ↔ TUI toggle(`onTab.tui`)을 받아 harness의 adapter로 그 탭의
// ACP session 하나를 연다.
// 어느 process를 끄고 띄우는지는 adapter의 `handoff`가 정한다(`adapter.ts`의 toggle 흐름). 이 file이 그 순서를 지킨다.
import type {
  AcpSessionHandle,
  AcpTabRequest,
  AcpTerminal,
  ExtensionContext,
  ExtensionSpawn,
} from "../../../../protocol/extensions/mod.ts";
import { redactCredentials } from "../../../../base/telemetry/log.ts";
import {
  HARNESS_GUI_ADAPTERS,
  type HarnessGuiAdapter,
  type HarnessGuiCarry,
  type HarnessGuiRun,
} from "./adapter.ts";

let stopAll: (() => void) | undefined;

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

/** 탭 하나의 GUI. `run`은 adapter가 시작을 마친 뒤에야 있다. */
type Tab = {
  terminal: AcpTerminal;
  adapter: HarnessGuiAdapter;
  session: AcpSessionHandle;
  run: HarnessGuiRun | null;
  closed: boolean;
  /** shared run이 마지막으로 본 CLI session id. 바뀌면 TUI client를 새 id로 다시 붙인다. */
  seen: string | null;
};

export function activate(ctx: ExtensionContext): void {
  const tabs = new Map<string, Tab>();
  // terminal id → 끝난 run이 넘긴 값. handle은 toggle과 resume마다 새로 열리므로 탭(terminal)에 둔다. 작은 값이라 터미널이 닫혀도 남긴다.
  const carried = new Map<string, HarnessGuiCarry>();
  const keepCarry = (terminalId: string, run: HarnessGuiRun | null) => {
    const carry = run?.carry?.();
    if (carry !== undefined) carried.set(terminalId, carry);
  };

  // env는 (spawn이 얹는 login shell) < 탭의 hook env < adapter가 바꾸는 칸 순서다. 탭의 hook env 덕에 GUI가 띄운 CLI의 hook도 같은
  // 탭으로 와서 GUI turn 동안에도 탭의 상태 점이 맞는다.
  const spawnFor =
    (terminal: AcpTerminal | null): ExtensionSpawn =>
    (command, args, options) =>
      ctx.spawn(command, args, {
        ...options,
        env: { ...terminal?.env, ...options?.env },
      });

  function fail(
    session: AcpSessionHandle,
    error: { code: string; message: string },
  ) {
    // handle은 열어 두고 오류를 끝난 turn으로 보인다. 닫는 것(TUI로 돌아가기)은 사람이다.
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
    const run = tab.run;
    const id = run?.sessionId() ?? null;
    if (run === null || id === null || id === tab.seen) return;
    const first = tab.seen === null;
    tab.seen = id;
    const { terminal } = tab;
    if (first || terminal.state() === "shell") return;
    terminal.signal("SIGTERM");
    if (await exited(terminal)) terminal.type(`${run.tuiCommand()}\r`);
  }

  async function gui(request: AcpTabRequest): Promise<void> {
    const { terminal, harness } = request;
    const adapter = HARNESS_GUI_ADAPTERS[harness];
    const session = ctx.acp.open({
      terminal,
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
    tabs.set(terminal.id, tab);
    session.onClose(() => {
      tab.closed = true;
      if (tabs.get(terminal.id) === tab) tabs.delete(terminal.id);
      const run = tab.run;
      tab.run = null;
      keepCarry(terminal.id, run);
      // 닫힌 handle이라 오류를 보일 곳이 없다.
      run?.stop().catch(() => {});
    });

    try {
      // TUI가 foreground에 있으면(TUI → GUI) 먼저 끈다. 한 session을 두 process가 같이 쓰지 않는다.
      // tracker가 TUI를 떠나면 session id를 잊으므로 `resume`은 요청이 이미 들고 있다.
      if (terminal.state() !== "shell") {
        const ended = await within(EXIT_WAIT_MS, adapter.exitTui(terminal), {
          ok: false as const,
          error: EXIT_TIMEOUT,
        });
        if (!ended.ok) return fail(session, ended.error);
        if (!(await exited(terminal))) return fail(session, EXIT_TIMEOUT);
      }
      if (tab.closed) return;

      const carry = carried.get(terminal.id);
      const started = await adapter.start({
        terminal,
        cwd: terminal.cwd,
        ...(request.resume === undefined ? {} : { resume: request.resume }),
        ...(carry === undefined ? {} : { carry }),
        session: {
          ...session,
          publish(update) {
            session.publish(update);
            if (adapter.handoff === "shared")
              void followSession(tab).catch(() => {});
          },
        },
        spawn: spawnFor(terminal),
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
    if (tab === undefined) return;
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
  stopAll = () => {
    offTab();
    for (const tab of [...tabs.values()]) tab.session.close();
  };
}

export function deactivate(): void {
  stopAll?.();
  stopAll = undefined;
}
