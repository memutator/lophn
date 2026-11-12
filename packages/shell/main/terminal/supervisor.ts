// Electron 실행당 terminal host 하나. 상속 private pipe로 띄우고 감독한다.
// host가 죽으면 살아 있던 터미널은 unknown이고 자동으로 다시 띄우지 않는다.
// 사람이 누른 열기·다시 시작만 죽은 host 뒤에 새 host를 하나 띄우고,
// 그 host에서 새 터미널을 연다. 옛 입력은 재생하지 않는다.

import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import type {
  TerminalOutput,
  TerminalReply,
  TerminalRuntime,
} from "../../ipc/terminal.ts";

type HostProcess = {
  stdin: {
    write(data: string): unknown;
    on(event: "error", listener: () => void): unknown;
  } | null;
  stdout: AsyncIterable<string | Uint8Array> | null;
  stderr: {
    on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown;
    on(event: "error", listener: () => void): unknown;
  } | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): unknown;
  on(event: "error", listener: () => void): unknown;
};

/** host가 답 줄을 내지 못해도 renderer의 IPC가 영영 기다리지 않게 한다. 가장 긴 정상 요청(close·restart)이 2초쯤이다. */
const REQUEST_TIMEOUT_MS = 10_000;
const STDERR_TAIL_BYTES = 4096;

/** host가 스스로 끝났을 때의 원인. stderr는 마지막 4 KiB다. */
export type HostExit = {
  code: number | null;
  signal: string | null;
  stderr: string;
};

type SpawnHost = (entry: string) => HostProcess;

/** shell 터미널의 foreground process argv가 바뀌었다. host가 훑어서 알린다. */
export type ForegroundChange = {
  terminal_ref: string;
  generation: number;
  argv: string[] | null;
};

/** host에서 온 runtime(요청의 답에 실린 것과 process가 끝났다는 줄)과 host가 사라진 일을 듣는다. */
type SupervisorListener = {
  runtime?(runtime: TerminalRuntime): void;
  output?(output: readonly TerminalOutput[]): void;
  foreground?(change: ForegroundChange): void;
  hostLost?(exit?: HostExit): void;
};

export type Supervisor = {
  on(listener: SupervisorListener): () => void;
  request(message: unknown): Promise<TerminalReply>;
  note(runtime: TerminalRuntime): void;
  runtimes(): readonly TerminalRuntime[];
  markHostLost(): TerminalRuntime[];
  stop(): TerminalRuntime[];
};

export function createSupervisor(options: {
  spawnHost: SpawnHost;
  entry: string;
}): Supervisor {
  const listeners = new Set<SupervisorListener>();
  // 창이 뜨자마자 host를 띄우지 않는다. 첫 요청이 child를 만든다.
  let child: HostProcess | undefined;
  const pending = new Map<string, (reply: TerminalReply) => void>();
  let requestSeq = 0;
  const runtimes = new Map<string, TerminalRuntime>();
  let lost = false;

  function ensure(): HostProcess | undefined {
    if (lost) return undefined;
    if (child && !child.killed) return child;
    child = attach(options.spawnHost(options.entry));
    return child;
  }

  /**
   * exit, spawn 실패(error), stdout 오류 어느 쪽이든 child마다 한 번만 끝 처리를 한다. 새 host를 띄운 뒤 옛 host의
   * 늦은 event가 새 host를 lost로 만들지 않도록 지금 child일 때만 onExit를 부른다.
   */
  function attach(proc: HostProcess): HostProcess {
    let ended = false;
    let stderrTail = "";
    const end = (code: number | null, signal: string | null): void => {
      if (ended) return;
      ended = true;
      if (child === proc) onExit({ code, signal, stderr: stderrTail });
    };
    if (proc.stdout) {
      readLines(proc.stdout, (line) => onLine(line)).catch(() =>
        end(null, null),
      );
    }
    proc.on("exit", end);
    proc.on("error", () => end(null, null));
    // host가 exit보다 먼저 죽으면 다음 write의 EPIPE가 stdin error로 온다. 받는 곳이 없으면 앱이 끝난다.
    proc.stdin?.on("error", () => {});
    proc.stderr?.on("error", () => {});
    proc.stderr?.on("data", (chunk) => {
      // 개발 terminal에서 보이던 host stderr를 그대로 보이게 한다.
      process.stderr.write(chunk);
      const text =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_BYTES);
    });
    return proc;
  }

  function refreshRuntime(runtime: TerminalRuntime): void {
    const known = runtimes.get(runtime.terminal_ref);
    if (known === undefined || known.generation <= runtime.generation) {
      runtimes.set(runtime.terminal_ref, runtime);
    }
  }

  function hostLost(exit?: HostExit): void {
    for (const listener of listeners) listener.hostLost?.(exit);
  }

  function onExit(exit: HostExit): void {
    lost = true;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({
        ok: false,
        reason: "host_lost",
        message: "terminal host exited",
      });
    }
    for (const runtime of runtimes.values()) {
      if (runtime.state === "running" || runtime.state === "starting") {
        runtime.state = "unknown";
        runtime.failure_reason = "host_lost";
        runtime.exit_code = null;
      }
    }
    hostLost(exit);
  }

  function onLine(line: string): void {
    let parsed: {
      id?: string;
      reply?: TerminalReply;
      runtime?: TerminalRuntime;
      output?: TerminalOutput[];
      foreground?: ForegroundChange;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.foreground) {
      for (const listener of listeners) {
        listener.foreground?.(parsed.foreground);
      }
    }
    if (parsed.output) {
      for (const listener of listeners) listener.output?.(parsed.output);
    }
    if (parsed.runtime) {
      refreshRuntime(parsed.runtime);
      for (const listener of listeners) listener.runtime?.(parsed.runtime);
    }
    if (parsed.id && parsed.reply) {
      const resolve = pending.get(parsed.id);
      if (resolve) {
        pending.delete(parsed.id);
        resolve(parsed.reply);
      }
    }
  }

  /** 사람이 누른 열기·다시 시작이 죽은 host 뒤에 새 host를 하나 띄운다. */
  function revive(): HostProcess {
    if (child && !child.killed && !lost) return child;
    child = attach(options.spawnHost(options.entry));
    lost = false;
    return child;
  }

  /** 결과 불명 터미널의 등록 폴더로 다시 여는 open 요청. */
  function reopenMessage(terminal: TerminalRuntime): unknown {
    return {
      type: "open",
      project: terminal.project,
      folder_ref: terminal.folder_ref,
      folders: terminal.folder_ref
        ? [{ folder_ref: terminal.folder_ref, path: terminal.cwd_at_start }]
        : [],
    };
  }

  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(message) {
      const type = (message as { type?: unknown } | null)?.type;
      // 사람이 누른 열기·다시 시작만 죽은 host 뒤를 살린다. input·resize·close·
      // snapshot 같은 자동 경로는 죽은 host에 닿지 않는다.
      const current =
        type === "open" || type === "restart" ? revive() : ensure();
      if (!current || current.killed || !current.stdin) {
        return Promise.resolve({
          ok: false,
          reason: "host_lost",
          message: "terminal host is not running",
        });
      }
      // 죽은 host 뒤 다시 시작은 새 host에 터미널이 없다. 다시 시작을 등록 폴더로
      // 다시 여는 open으로 옮긴다. 옛 입력은 재생하지 않는다.
      let body: unknown = message;
      if (type === "restart") {
        const ref = (message as { terminal_ref?: unknown }).terminal_ref;
        const terminal =
          typeof ref === "string" ? runtimes.get(ref) : undefined;
        if (!terminal) {
          return Promise.resolve({
            ok: false,
            reason: "host_lost",
            message: "generation does not match",
          });
        }
        if (
          terminal.state === "unknown" ||
          (terminal.state === "exited" && terminal.failure_reason !== null)
        ) {
          body = reopenMessage(terminal);
        }
      }
      const id = `req_${++requestSeq}`;
      const payload = JSON.stringify({ ...(body as object), id }) + "\n";
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({
            ok: false,
            reason: "host_lost",
            message: "terminal host did not answer",
          });
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        current.stdin?.write(payload);
      });
    },
    note(runtime) {
      refreshRuntime(runtime);
    },
    runtimes() {
      return [...runtimes.values()];
    },
    markHostLost() {
      lost = true;
      return this.stop();
    },
    stop() {
      lost = true;
      try {
        child?.kill("SIGTERM");
      } catch {
        // 이미 죽은 host는 unknown으로 남긴다.
      }
      const gone: TerminalRuntime[] = [];
      for (const runtime of runtimes.values()) {
        if (runtime.state === "running" || runtime.state === "starting") {
          runtime.state = "unknown";
          runtime.failure_reason = "host_lost";
          runtime.exit_code = null;
        }
        gone.push({ ...runtime });
      }
      runtimes.clear();
      for (const runtime of gone) runtimes.set(runtime.terminal_ref, runtime);
      hostLost();
      return gone;
    },
  };
}

export async function readLines(
  stream: AsyncIterable<string | Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let parts: string[] = [];
  for await (const piece of stream) {
    const text = typeof piece === "string" ? piece : decoder.write(piece);
    let start = 0;
    let nl = text.indexOf("\n");
    while (nl >= 0) {
      parts.push(text.slice(start, nl));
      const line = parts.join("");
      parts = [];
      if (line.length > 0) onLine(line);
      start = nl + 1;
      nl = text.indexOf("\n", start);
    }
    if (start < text.length) parts.push(text.slice(start));
  }
}

export function spawnNodeHost(entry: string): ChildProcess {
  // Electron main에서 process.execPath는 Electron이다. 이 표시가 없으면
  // host가 두 번째 Electron 앱으로 떠 second-instance가 된다.
  return spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      LOPHN_TERMINAL_HOST: "1",
    },
  });
}
