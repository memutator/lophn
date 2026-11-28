// 터미널 service: core가 자식으로 띄운 PTY host 위의 `Terminals`다. 열기 순서(폴더 다시 읽기, env, 첫 출력 뒤 명령 치기)와 runtime
// 표(tracker가 실은 agent·탭 이름)를 갖는다. 누가 칠 수 있는지와 출력 lease는 route handler(routes.ts)가 본다.
import { dirname } from "node:path";

import { type ErrorCode, err, ok, type Result } from "../../base/mod.ts";
import { prependPath } from "../../base/os/mod.ts";
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/mod.ts";
import type { TerminalLine } from "../../protocol/coding-agent/terminal-view.ts";
import {
  HOME_TERMINAL_PROJECT,
  type TerminalAgent,
  type TerminalFailure,
  type TerminalOutput,
  type TerminalRuntime,
} from "../../protocol/coding-agent/terminals.ts";
import { folderOfCwd } from "./cwd.ts";
import type {
  HostReply,
  HostScreenReply,
  HostSnapshotReply,
  HostTuiSnapshotReply,
  HostTuiStateReply,
} from "./host/wire.ts";
import { encodePaste } from "./input-encoder.ts";
import type {
  PersonEnv,
  TerminalClipboardWrite,
  TerminalEnvHook,
  TerminalForeground,
  Terminals,
} from "./ports.ts";
import {
  createSupervisor,
  type HostExit,
  type HostProcess,
} from "./supervisor.ts";

type Folder = { folder_ref: string; path: string };

const FAILURE_CODES: Record<TerminalFailure, ErrorCode> = {
  no_folder: "invalid_input",
  not_directory: "invalid_input",
  unreadable: "invalid_input",
  spawn_failed: "unavailable",
  kill_unconfirmed: "unavailable",
  host_lost: "unavailable",
};

const failed = (reason: TerminalFailure, message: string) =>
  err({ code: FAILURE_CODES[reason], message, details: { reason } });

// 열고 닫고 다시 띄운 답. PTY를 띄우지 못했거나 끝난 것을 확인하지 못한 runtime도 host는 ok로 주므로 여기서 실패로 바꾼다.
function settled(reply: HostReply): Result<TerminalRuntime> {
  if (!reply.ok) return failed(reply.reason, reply.message);
  const reason = reply.runtime.failure_reason;
  if (reason === "spawn_failed" || reason === "kill_unconfirmed") {
    return failed(reason, `terminal ${reason}`);
  }
  return ok(reply.runtime);
}

/**
 * 열 때 넣을 명령의 입력 글. 한 줄이면 Enter까지 쳐서 실행한다. 여러 줄이면 라이브 bracketed_paste 모드에 따라
 * 순수 인코더(`encodePaste`)로 안전하게 인코딩한다(ESC[201~·NUL 제거).
 */
function commandInput(
  command: string | undefined,
  bracketedPaste = true,
): string | null {
  const text = command?.replace(/\r\n?/g, "\n").replace(/\n+$/, "") ?? "";
  if (text.trim() === "") return null;
  if (!text.includes("\n")) return `${text}\r`;
  const encoded = encodePaste(text, { bracketed_paste: bracketedPaste });
  return encoded.ok ? encoded.value : null;
}

// 저장한 session을 다시 여는 명령 한 줄. resume 규칙이 없는 harness면 null이다.
// Settings › Coding agents에 저장한 command(flag 포함)가 있으면 그 명령을 바탕으로 resume 인자를 붙인다.
export function buildResumeCommand(
  resume: {
    harness: string;
    external_session: string;
  },
  savedCommand?: string,
): string | null {
  if (!Object.hasOwn(HARNESS_ADAPTERS, resume.harness)) return null;
  const adapter =
    HARNESS_ADAPTERS[resume.harness as keyof typeof HARNESS_ADAPTERS];
  if (adapter.session.resume === null) return null;
  const custom = savedCommand?.trim() ?? "";
  const base =
    custom !== "" && !/[\r\n]/.test(custom) ? custom : adapter.commands[0];
  let resumeArgs = adapter.session.resume.map((arg) =>
    arg.replace("{id}", resume.external_session),
  );
  // kiro(`chat --resume-id {id}`)처럼 subcommand로 시작하는 resume 규칙은 저장된 명령에 이미 같은 subcommand가 있으면 중복하지 않는다.
  const first = resumeArgs[0];
  if (
    first !== undefined &&
    !first.startsWith("-") &&
    base.split(/\s+/).slice(1).includes(first)
  ) {
    resumeArgs = resumeArgs.slice(1);
  }
  return [base, ...resumeArgs].join(" ");
}

// TerminalRuntimeChanged는 runtime의 뜻이 바뀔 때만 간다. 출력마다 오르는 seq와 넘침 표시는 출력 쪽 일이다.
function shapeOf(runtime: TerminalRuntime): string {
  const { output_seq: _seq, dropped_output: _dropped, ...rest } = runtime;
  return JSON.stringify(rest);
}

export function createTerminals(deps: {
  // PTY host process 하나를 띄운다. env는 사람의 login env다.
  spawnHost(env: Readonly<Record<string, string>>): HostProcess;
  personEnv: PersonEnv;
  // project의 등록 폴더(`folder_ref`는 `<project>_<index>`). Home은 사람의 home 폴더 하나다. 없는 project는 not_found다.
  folders(project: string): Promise<Result<readonly Folder[]>>;
  platform: NodeJS.Platform;
  // 사람이 Settings › Coding agents에 저장한 실행 명령어(flag 포함). resume 시 기본 명령어 대신 쓴다.
  codingCommand?(harness: string): string | undefined;
  // host가 스스로 끝났다(code, signal, stderr 마지막 4 KiB).
  hostExited(exit: HostExit): void;
}): Terminals {
  // host는 첫 열기 때 띄운다. 그 전에 사람의 env를 읽어 여기 둔다.
  let hostEnv: Readonly<Record<string, string>> = {};
  const supervisor = createSupervisor({
    spawnHost: () => deps.spawnHost(hostEnv),
  });
  const extras = new Map<
    string,
    {
      agent?: TerminalAgent;
      tab_name?: string;
      agent_control?: { held: boolean };
    }
  >();
  // 같은 scrollback을 PTY host가 생략했을 때 이어 붙일 마지막 scrollback 사본.
  const scrollbacks = new Map<
    string,
    { generation: number; key: string; lines: TerminalLine[] }
  >();
  const shapes = new Map<string, string>();
  const runtimeListeners = new Set<(runtime: TerminalRuntime) => void>();
  const outputListeners = new Set<
    (output: readonly TerminalOutput[]) => void
  >();
  const foregroundListeners = new Set<(change: TerminalForeground) => void>();
  const clipboardListeners = new Set<(write: TerminalClipboardWrite) => void>();
  const humanListeners = new Set<(terminal: string, text: string) => void>();
  const envHooks = new Set<TerminalEnvHook>();

  function decorate(runtime: TerminalRuntime): TerminalRuntime {
    const extra = extras.get(runtime.terminal_ref);
    const {
      agent: _agent,
      tab_name: _name,
      agent_control: _control,
      ...bare
    } = runtime;
    return {
      ...bare,
      ...(extra?.agent === undefined ? {} : { agent: extra.agent }),
      ...(extra?.tab_name === undefined ? {} : { tab_name: extra.tab_name }),
      ...(extra?.agent_control === undefined
        ? {}
        : { agent_control: extra.agent_control }),
    };
  }

  function current(terminal: string): TerminalRuntime | undefined {
    return supervisor.runtimes().find((one) => one.terminal_ref === terminal);
  }

  function changed(runtime: TerminalRuntime): void {
    const decorated = decorate(runtime);
    const shape = shapeOf(decorated);
    if (shapes.get(runtime.terminal_ref) === shape) return;
    shapes.set(runtime.terminal_ref, shape);
    for (const listener of runtimeListeners) listener(decorated);
  }

  supervisor.on({
    runtime: changed,
    output(output) {
      for (const listener of outputListeners) listener(output);
    },
    foreground(change) {
      for (const listener of foregroundListeners) listener(change);
    },
    clipboard(write) {
      for (const listener of clipboardListeners) listener(write);
    },
    hostLost(exit) {
      scrollbacks.clear();
      if (exit !== undefined) deps.hostExited(exit);
      for (const runtime of supervisor.runtimes()) changed(runtime);
    },
  });

  // 없는 터미널은 not_found, generation을 주었는데 지금 것이 아니면 conflict다. 죽은 host를 띄우지 않으려고 host에 묻기 전에 본다.
  function target(
    terminal: string,
    generation?: number,
  ): Result<TerminalRuntime> {
    const found = current(terminal);
    if (found === undefined) {
      return err({ code: "not_found", message: "terminal is not open" });
    }
    if (generation !== undefined && generation !== found.generation) {
      return err({
        code: "conflict",
        message: "terminal generation is not current",
      });
    }
    return ok(found);
  }

  async function typeInto(
    terminal: string,
    generation: number,
    text: string,
  ): Promise<Result<void>> {
    const reply = await supervisor.request({
      type: "input",
      terminal_ref: terminal,
      generation,
      text,
    });
    return reply.ok ? ok(undefined) : failed(reply.reason, reply.message);
  }

  // shell은 시작 층(rc)을 읽는 동안 친 글을 버리고, rc를 읽는 동안은 출력도 없다. 첫 출력(prompt) 뒤 300ms 잠잠하면 친다.
  // prompt는 열기 답보다 늦게 나오므로 듣기 전에 지나가지 않는다. 5초면 그냥 친다.
  function quiet(terminal: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        clearTimeout(cap);
        off();
        resolve();
      };
      const cap = setTimeout(done, 5000);
      const off = supervisor.on({
        output(chunks) {
          if (!chunks.some((chunk) => chunk.terminal_ref === terminal)) return;
          clearTimeout(timer);
          timer = setTimeout(done, 300);
        },
      });
    });
  }

  return {
    async open(input) {
      const folders = await deps.folders(input.project);
      if (!folders.ok) return folders;
      const start =
        input.cwd === undefined ? null : folderOfCwd(folders.value, input.cwd);
      if (start !== null && !start.ok) {
        return failed("unreadable", "cwd is not inside a registered folder");
      }
      hostEnv = await deps.personEnv.env();
      const cli = deps.personEnv.cli;
      const path =
        cli === null
          ? undefined
          : prependPath(hostEnv, dirname(cli), deps.platform);
      const isAgent = input.agent === true;
      const isDedicated =
        input.dedicated === true || (!isAgent && input.exec !== undefined);
      const hooked =
        isDedicated || isAgent ? [] : [...envHooks].map((hook) => hook(input));
      const env: Record<string, string> = {
        // 사람 token의 `lophn tab open --url`이 이 project에 탭을 놓게 한다. Home은 env가 없을 때의 기본이라 넣지 않는다.
        ...(input.project === HOME_TERMINAL_PROJECT
          ? {}
          : { LOPHN_WORKSPACE: JSON.stringify({ project: input.project }) }),
        // 개발 실행은 PATH에 `lophn`이 없다. 설치본은 이미 있어 더하지 않는다.
        ...(path === undefined ? {} : { [path.name]: path.value }),
        ...Object.assign({}, ...hooked.map((one) => one.env)),
        ...(input.env ?? {}),
      };
      const done = settled(
        await supervisor.request({
          type: "open",
          project: input.project,
          folder_ref: start?.folder_ref ?? input.folder_ref,
          ...(start === null ? {} : { cwd: start.path }),
          folders: folders.value,
          columns: input.columns ?? 80,
          rows: input.rows ?? 24,
          env,
          ...(input.exec === undefined ? {} : { exec: input.exec }),
          ...(input.terminal_ref === undefined
            ? {}
            : { terminal_ref: input.terminal_ref }),
          ...(isDedicated ? { dedicated: true as const } : {}),
          ...(isAgent ? { agent: true as const } : {}),
        }),
      );
      const runtime = done.ok ? decorate(done.value) : null;
      for (const one of hooked) one.opened(runtime);
      if (runtime === null) return done;
      if (isDedicated || isAgent) return ok(runtime);
      const line =
        input.resume === undefined
          ? null
          : buildResumeCommand(
              input.resume,
              deps.codingCommand?.(input.resume.harness),
            );
      if (line !== null || input.command !== undefined) {
        // 터미널은 이미 열렸다. 친 줄이 거절돼도 열기를 실패로 만들지 않고 다시 치지 않는다.
        void quiet(runtime.terminal_ref).then(async () => {
          if (line !== null) {
            await typeInto(
              runtime.terminal_ref,
              runtime.generation,
              `${line}\r`,
            );
            return;
          }
          // 여러 줄 명령은 라이브 bracketed_paste 모드를 읽어 순수 인코더로 안전하게 인코딩한다.
          const liveState = (await supervisor.request({
            type: "tui_state",
            terminal_ref: runtime.terminal_ref,
          })) as HostTuiStateReply | HostReply;
          const bracketed =
            liveState.ok && "state" in liveState
              ? liveState.state.modes.bracketed_paste
              : false;
          const typed = commandInput(input.command, bracketed);
          if (typed !== null) {
            await typeInto(runtime.terminal_ref, runtime.generation, typed);
          }
        });
      }
      return ok(runtime);
    },

    async close(terminal, generation) {
      const found = target(terminal, generation);
      if (!found.ok) return found;
      const done = settled(
        await supervisor.request({
          type: "close",
          terminal_ref: terminal,
          generation,
        }),
      );
      return done.ok ? ok(decorate(done.value)) : done;
    },

    async restart(terminal, generation) {
      const found = target(terminal, generation);
      if (!found.ok) return found;
      const done = settled(
        await supervisor.request({
          type: "restart",
          terminal_ref: terminal,
          generation,
        }),
      );
      return done.ok ? ok(decorate(done.value)) : done;
    },

    async write(terminal, text, options) {
      const found = target(terminal, options.generation);
      if (!found.ok) return found;
      const done = await typeInto(terminal, found.value.generation, text);
      if (done.ok && options.human) {
        for (const listener of humanListeners) listener(terminal, text);
      }
      return done;
    },

    async signal(terminal, generation, signal) {
      const found = target(terminal, generation);
      if (!found.ok) return found;
      const reply = await supervisor.request({
        type: "signal",
        terminal_ref: terminal,
        generation,
        signal,
      });
      return reply.ok ? ok(undefined) : failed(reply.reason, reply.message);
    },

    async resize(terminal, generation, size, options) {
      const found = target(terminal, generation);
      if (!found.ok) return found;
      const reply = await supervisor.request({
        type: "resize",
        terminal_ref: terminal,
        generation,
        columns: size.columns,
        rows: size.rows,
        ...(options.remote ? { remote: true as const } : {}),
      });
      return reply.ok
        ? ok(decorate(reply.runtime))
        : failed(reply.reason, reply.message);
    },

    async snapshot(terminal, afterSeq) {
      const found = target(terminal);
      if (!found.ok) return found;
      const reply = (await supervisor.request({
        type: "snapshot",
        terminal_ref: terminal,
        after_seq: afterSeq,
      })) as HostSnapshotReply | HostReply;
      if (!reply.ok) return failed(reply.reason, reply.message);
      return ok({
        runtime: decorate(reply.runtime),
        output: "output" in reply ? reply.output : [],
      });
    },

    async screen(terminal, tail, known) {
      const found = target(terminal);
      if (!found.ok) return found;
      const cached = scrollbacks.get(terminal);
      const scrollbackKey =
        known?.scrollbackKey !== undefined &&
        cached !== undefined &&
        cached.generation === found.value.generation &&
        cached.key === known.scrollbackKey
          ? known.scrollbackKey
          : undefined;
      const reply = (await supervisor.request({
        type: "screen",
        terminal_ref: terminal,
        tail,
        ...(known === undefined
          ? {}
          : {
              after_seq: known.afterSeq,
              generation: known.generation,
              columns: known.columns,
              rows: known.rows,
            }),
        ...(scrollbackKey === undefined
          ? {}
          : { scrollback_key: scrollbackKey }),
      })) as HostScreenReply | HostReply;
      if (!reply.ok) return failed(reply.reason, reply.message);
      if ("unchanged" in reply) return ok(null);
      if (!("screen" in reply)) return failed("host_lost", "terminal is gone");
      const raw = reply.screen;
      if (raw.scrollback !== undefined) {
        scrollbacks.set(terminal, {
          generation: raw.generation,
          key: raw.scrollback_key,
          lines: raw.scrollback,
        });
        return ok({ ...raw, scrollback: raw.scrollback });
      }
      const reused = scrollbacks.get(terminal);
      if (
        reused === undefined ||
        reused.generation !== raw.generation ||
        reused.key !== raw.scrollback_key
      ) {
        // cache가 어긋났으면 scrollback까지 포함해 한 번 다시 읽는다.
        const fresh = (await supervisor.request({
          type: "screen",
          terminal_ref: terminal,
          tail,
        })) as HostScreenReply | HostReply;
        if (!fresh.ok) return failed(fresh.reason, fresh.message);
        if (!("screen" in fresh) || fresh.screen.scrollback === undefined) {
          return failed("host_lost", "terminal is gone");
        }
        scrollbacks.set(terminal, {
          generation: fresh.screen.generation,
          key: fresh.screen.scrollback_key,
          lines: fresh.screen.scrollback,
        });
        return ok({ ...fresh.screen, scrollback: fresh.screen.scrollback });
      }
      return ok({ ...raw, scrollback: reused.lines });
    },

    async tuiState(terminal) {
      const found = target(terminal);
      if (!found.ok) return found;
      const reply = (await supervisor.request({
        type: "tui_state",
        terminal_ref: terminal,
      })) as HostTuiStateReply | HostReply;
      if (!reply.ok) return failed(reply.reason, reply.message);
      if (!("state" in reply)) return failed("host_lost", "terminal is gone");
      return ok({ runtime: decorate(reply.runtime), state: reply.state });
    },

    async tuiSnapshot(terminal, options) {
      const found = target(terminal);
      if (!found.ok) return found;
      const reply = (await supervisor.request({
        type: "tui_snapshot",
        terminal_ref: terminal,
        ...(options?.scrollback === undefined
          ? {}
          : { scrollback: options.scrollback }),
        ...(options?.ansi === undefined ? {} : { ansi: options.ansi }),
      })) as HostTuiSnapshotReply | HostReply;
      if (!reply.ok) return failed(reply.reason, reply.message);
      if (!("snapshot" in reply)) {
        return failed("host_lost", "terminal is gone");
      }
      return ok({
        runtime: decorate(reply.runtime),
        snapshot: reply.snapshot,
      });
    },

    setClientAttached(terminal, attached) {
      if (current(terminal) === undefined) return;
      void supervisor.request({
        type: "client_attached",
        terminal_ref: terminal,
        attached,
      });
    },

    list(project) {
      return supervisor
        .runtimes()
        .filter((one) => project === undefined || one.project === project)
        .map(decorate);
    },

    runtime(terminal) {
      const found = current(terminal);
      return found === undefined ? null : decorate(found);
    },

    patch(terminal, patch) {
      const found = current(terminal);
      if (found === undefined) return;
      const extra = { ...extras.get(terminal) };
      if (patch.agent === null) delete extra.agent;
      else if (patch.agent !== undefined) extra.agent = patch.agent;
      if (patch.tab_name === "") delete extra.tab_name;
      else if (patch.tab_name !== undefined) extra.tab_name = patch.tab_name;
      if (patch.agent_control === null) delete extra.agent_control;
      else if (patch.agent_control !== undefined) {
        extra.agent_control = patch.agent_control;
      }
      extras.set(terminal, extra);
      changed(found);
    },

    onRuntime(listener) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onForeground(listener) {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    onClipboard(listener) {
      clipboardListeners.add(listener);
      return () => clipboardListeners.delete(listener);
    },
    onHumanInput(listener) {
      humanListeners.add(listener);
      return () => humanListeners.delete(listener);
    },
    useEnv(hook) {
      envHooks.add(hook);
      return () => envHooks.delete(hook);
    },

    anyOpen() {
      return supervisor
        .runtimes()
        .some((one) => one.state === "running" || one.state === "starting");
    },

    stop: () => supervisor.stop(),
  };
}
