// extension 입구. 터미널 탭의 `<harness> gui`(`onTab.gui`)와 GUI ↔ TUI toggle(`onTab.tui`)을 받아 harness의 adapter로 그 탭의
// ACP session 하나를 연다.
// 어느 process를 끄고 띄우는지는 adapter의 `handoff`가 정한다(`adapter.ts`의 toggle 흐름). 이 file이 그 순서를 지킨다.
import type {
  AcpSessionHandle,
  AcpTabRequest,
  AcpTerminal,
  ExtensionContext,
  ExtensionSpawn,
} from "../../../../../protocol/extensions/mod.ts";
import {
  HARNESS_GUI_ADAPTERS,
  type HarnessGuiAdapter,
  type HarnessGuiRun,
} from "./adapter.ts";

let stopAll: (() => void) | undefined;

const ENV_BEGIN = "<<lophn-env-begin>>";
const ENV_END = "<<lophn-env-end>>";
const ENV_WAIT_MS = 5000;
// TUI를 끄는 데 걸리는 시간의 상한. SIGKILL은 보내지 않는다(대화 기록을 덜 쓴 채 끊지 않는다).
const EXIT_WAIT_MS = 5000;
// login shell을 한 번 띄운 값이라 이 process의 것이다. CLI에 물려주면 틀리다.
const LOGIN_ONLY = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

/** `env -0`의 출력(표시 사이의 NUL로 나뉜 `NAME=value`)을 읽는다. 표시가 없으면 undefined. */
export function parseLoginEnv(out: string): Record<string, string> | undefined {
  const start = out.indexOf(ENV_BEGIN);
  const end = out.indexOf(ENV_END, start);
  if (start < 0 || end < 0) return undefined;
  const env: Record<string, string> = {};
  for (const entry of out.slice(start + ENV_BEGIN.length, end).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!LOGIN_ONLY.has(name)) env[name] = entry.slice(eq + 1);
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

// 데스크톱 메뉴나 autostart로 뜬 앱의 env에는 사람의 shell 설정(nvm의 PATH, rc file에 둔 API key)이 없다. 사람의 login shell에서
// env 전체를 읽는다. rc file이 tmux나 updater를 띄우지 않게 막고(Emdash), 다른 글을 찍을 수 있어 표시 사이의 값만 쓴다.
// 못 읽으면 undefined라 shell main의 env를 그대로 쓴다.
function loginEnv(
  spawn: ExtensionSpawn,
): Promise<Record<string, string> | undefined> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.env.SHELL || "/bin/sh",
      ["-ilc", `printf '%s' '${ENV_BEGIN}'; env -0; printf '%s' '${ENV_END}'`],
      {
        env: {
          DISABLE_AUTO_UPDATE: "true",
          ZSH_TMUX_AUTOSTART: "false",
          ZSH_TMUX_AUTOSTARTED: "true",
        },
      },
    );
    let out = "";
    let done = false;
    const finish = (value: Record<string, string> | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(undefined);
    }, ENV_WAIT_MS);
    proc.onStdout((text) => {
      out += text;
    });
    proc.onExit(() => finish(parseLoginEnv(out)));
  });
}

const EXIT_TIMEOUT = {
  code: "unavailable",
  message: "The coding agent did not exit in 5 seconds.",
} as const;

function within<T>(ms: number, work: Promise<T>, otherwise: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(otherwise), ms);
    void work.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
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
  let login: Promise<Record<string, string> | undefined> | undefined;

  // env는 login shell < 탭의 hook env < adapter가 바꾸는 칸 순서다. 탭의 hook env 덕에 GUI가 띄운 CLI의 hook도 같은 탭으로
  // 와서 GUI turn 동안에도 탭의 상태 점이 맞는다.
  async function spawnFor(
    terminal: AcpTerminal | null,
  ): Promise<ExtensionSpawn> {
    login ??= loginEnv(ctx.spawn);
    const env = await login;
    return (command, args, options) =>
      ctx.spawn(command, args, {
        ...options,
        env: { ...env, ...terminal?.env, ...options?.env },
      });
  }

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
      void run?.stop();
    });

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

    const started = await adapter.start({
      terminal,
      cwd: terminal.cwd,
      ...(request.resume === undefined ? {} : { resume: request.resume }),
      session: {
        ...session,
        publish(update) {
          session.publish(update);
          if (adapter.handoff === "shared") void followSession(tab);
        },
      },
      spawn: await spawnFor(terminal),
      clock: ctx.clock,
      ids: ctx.ids,
    });
    if (!started.ok) return fail(session, started.error);
    // 시작하는 동안 handle이 닫혔다.
    if (tab.closed) return void started.value.stop();
    tab.run = started.value;
    tab.seen = started.value.sessionId() ?? tab.seen;
  }

  async function tui(terminalId: string): Promise<void> {
    const tab = tabs.get(terminalId);
    if (tab === undefined) return;
    const { run, terminal } = tab;
    if (tab.adapter.handoff === "restart") {
      // CLI가 끝난 뒤에야 handle을 닫고 같은 session을 TUI로 잇는다.
      tab.run = null;
      let command: string | undefined;
      if (run !== null) {
        await run.stop();
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
