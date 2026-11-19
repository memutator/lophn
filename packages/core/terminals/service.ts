// 터미널 service: core가 자식으로 띄운 PTY host 위의 `Terminals`다. 열기 순서(폴더 다시 읽기, env, 첫 출력 뒤 명령 치기)와 runtime
// 표(tracker가 실은 agent·탭 이름)를 갖는다. 누가 칠 수 있는지와 출력 lease는 route handler(routes.ts)가 본다.
import { dirname } from "node:path";

import { type ErrorCode, err, ok, type Result } from "../../base/mod.ts";
import { prependPath } from "../../base/os/mod.ts";
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/mod.ts";
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
} from "./host/wire.ts";
import type {
  PersonEnv,
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
 * 열 때 넣을 명령의 입력 글. 한 줄이면 Enter까지 쳐서 실행한다. 여러 줄이면 bracketed paste로 감싸 붙여 넣기만
 * 한다. 줄마다 실행되지 않고 사람이 보고 Enter를 누른다(bash·zsh는 5.1부터 bracketed paste가 기본이다).
 */
function commandInput(command: string | undefined): string | null {
  const text = command?.replace(/\r\n?/g, "\n").replace(/\n+$/, "") ?? "";
  if (text.trim() === "") return null;
  return text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : `${text}\r`;
}

// 저장한 session을 다시 여는 명령 한 줄. resume 규칙이 없는 harness면 null이다.
function resumeLine(resume: {
  harness: string;
  external_session: string;
}): string | null {
  if (!Object.hasOwn(HARNESS_ADAPTERS, resume.harness)) return null;
  const adapter =
    HARNESS_ADAPTERS[resume.harness as keyof typeof HARNESS_ADAPTERS];
  if (adapter.session.resume === null) return null;
  return [
    adapter.commands[0],
    ...adapter.session.resume.map((arg) =>
      arg.replace("{id}", resume.external_session),
    ),
  ].join(" ");
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
    { agent?: TerminalAgent; tab_name?: string }
  >();
  const shapes = new Map<string, string>();
  const runtimeListeners = new Set<(runtime: TerminalRuntime) => void>();
  const outputListeners = new Set<
    (output: readonly TerminalOutput[]) => void
  >();
  const foregroundListeners = new Set<(change: TerminalForeground) => void>();
  const humanListeners = new Set<(terminal: string, text: string) => void>();
  const envHooks = new Set<TerminalEnvHook>();

  function decorate(runtime: TerminalRuntime): TerminalRuntime {
    const extra = extras.get(runtime.terminal_ref);
    const { agent: _agent, tab_name: _name, ...bare } = runtime;
    return {
      ...bare,
      ...(extra?.agent === undefined ? {} : { agent: extra.agent }),
      ...(extra?.tab_name === undefined ? {} : { tab_name: extra.tab_name }),
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
    hostLost(exit) {
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
      const hooked = [...envHooks].map((hook) => hook(input));
      const env: Record<string, string> = {
        // 사람 token의 `lophn tab open --url`이 이 project에 탭을 놓게 한다. Home은 env가 없을 때의 기본이라 넣지 않는다.
        ...(input.project === HOME_TERMINAL_PROJECT
          ? {}
          : { LOPHN_WORKSPACE: JSON.stringify({ project: input.project }) }),
        // 개발 실행은 PATH에 `lophn`이 없다. 설치본은 이미 있어 더하지 않는다.
        ...(path === undefined ? {} : { [path.name]: path.value }),
        ...Object.assign({}, ...hooked.map((one) => one.env)),
      };
      const done = settled(
        await supervisor.request({
          type: "open",
          project: input.project,
          folder_ref: start?.folder_ref ?? input.folder_ref,
          ...(start === null ? {} : { cwd: start.path }),
          folders: folders.value,
          columns: 80,
          rows: 24,
          env,
        }),
      );
      const runtime = done.ok ? decorate(done.value) : null;
      for (const one of hooked) one.opened(runtime);
      if (runtime === null) return done;
      const line = input.resume === undefined ? null : resumeLine(input.resume);
      const typed = line !== null ? `${line}\r` : commandInput(input.command);
      if (typed !== null) {
        // 터미널은 이미 열렸다. 친 줄이 거절돼도 열기를 실패로 만들지 않고 다시 치지 않는다.
        void quiet(runtime.terminal_ref).then(() =>
          typeInto(runtime.terminal_ref, runtime.generation, typed),
        );
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

    async screen(terminal, tail) {
      const found = target(terminal);
      if (!found.ok) return found;
      const reply = (await supervisor.request({
        type: "screen",
        terminal_ref: terminal,
        tail,
      })) as HostScreenReply | HostReply;
      if (!reply.ok) return failed(reply.reason, reply.message);
      if (!("screen" in reply)) return failed("host_lost", "terminal is gone");
      return ok(reply.screen);
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
