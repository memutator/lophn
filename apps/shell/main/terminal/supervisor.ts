// Electron 실행당 terminal host 하나. 상속 private pipe로 띄우고 감독한다.
// host가 죽으면 살아 있던 터미널은 unknown이고 자동으로 다시 띄우지 않는다.

import { type ChildProcess, spawn } from "node:child_process";

import type { TerminalReply, TerminalRuntime } from "../../ipc/terminal.ts";

export type HostProcess = {
  stdin: { write(data: string): void } | null;
  stdout: AsyncIterable<string | Uint8Array> | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null) => void): void;
};

export type SpawnHost = (entry: string) => HostProcess;

export type Supervisor = {
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
  // 창이 뜨자마자 host를 띄우지 않는다. 첫 요청이 child를 만든다.
  let child: HostProcess | undefined;
  const pending = new Map<string, (reply: TerminalReply) => void>();
  const runtimes = new Map<string, TerminalRuntime>();
  let lost = false;

  function ensure(): HostProcess | undefined {
    if (lost) return undefined;
    if (child && !child.killed) return child;
    child = options.spawnHost(options.entry);
    const stdout = child.stdout;
    if (stdout) {
      void readLines(stdout, (line) => onLine(line));
    }
    child.on("exit", () => onExit());
    return child;
  }

  function onExit(): void {
    lost = true;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({
        ok: false,
        reason: "host_lost",
        message: "terminal host exited",
      });
      void id;
    }
    for (const runtime of runtimes.values()) {
      if (runtime.state === "running" || runtime.state === "starting") {
        runtime.state = "unknown";
        runtime.failure_reason = "host_lost";
        runtime.exit_code = null;
      }
    }
  }

  function onLine(line: string): void {
    let parsed: {
      id?: string;
      reply?: TerminalReply;
      runtime?: TerminalRuntime;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.runtime) {
      runtimes.set(parsed.runtime.terminal_ref, parsed.runtime);
    }
    if (parsed.id && parsed.reply) {
      const resolve = pending.get(parsed.id);
      if (resolve) {
        pending.delete(parsed.id);
        resolve(parsed.reply);
      }
    }
  }

  return {
    request(message) {
      const current = ensure();
      if (!current || current.killed || !current.stdin) {
        return Promise.resolve({
          ok: false,
          reason: "host_lost",
          message: "terminal host is not running",
        });
      }
      const id = `req_${pending.size}_${Date.now()}`;
      const body = JSON.stringify({ ...(message as object), id }) + "\n";
      return new Promise((resolve) => {
        pending.set(id, resolve);
        current.stdin?.write(body);
      });
    },
    note(runtime) {
      runtimes.set(runtime.terminal_ref, runtime);
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
      return gone;
    },
  };
}

async function readLines(
  stream: AsyncIterable<string | Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  let buffer = "";
  for await (const piece of stream) {
    buffer += typeof piece === "string"
      ? piece
      : new TextDecoder().decode(piece);
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) onLine(line);
      nl = buffer.indexOf("\n");
    }
  }
}

export function spawnNodeHost(entry: string): ChildProcess {
  // Electron main에서 process.execPath는 Electron이다. 이 표시가 없으면
  // host가 두 번째 Electron 앱으로 떠 second-instance가 된다.
  return spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      LOPHN_TERMINAL_HOST: "1",
    },
  });
}
