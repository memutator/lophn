export type Spawned = {
  pid: number;
  stdin: {
    write(bytes: Uint8Array): Promise<void>;
    close(): Promise<void>;
  };
  stdout: { read(buffer: Uint8Array): Promise<number | null> };
  stderr: { read(buffer: Uint8Array): Promise<number | null> };
  // 정상 종료 code. 신호로 죽으면 null.
  exited: Promise<number | null>;
  // 새 process group 전체를 끝낸다. PID 파일은 쓰지 않는다.
  killGroup(signal: "SIGTERM" | "SIGKILL"): void;
};

export type SpawnRequest = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

type Pipe = { read(buffer: Uint8Array): Promise<number | null> };

function fromWeb(stream: ReadableStream<Uint8Array>): Pipe {
  const reader = stream.getReader();
  let pending: Uint8Array | undefined;
  let pendingOffset = 0;
  return {
    async read(buffer) {
      while (true) {
        if (!pending || pendingOffset >= pending.length) {
          const next = await reader.read();
          if (next.done) return null;
          pending = next.value;
          pendingOffset = 0;
        }
        const count = Math.min(buffer.length, pending.length - pendingOffset);
        buffer.set(pending.subarray(pendingOffset, pendingOffset + count));
        pendingOffset += count;
        return count;
      }
    },
  };
}

// setsid --fork로 새 session의 그룹 리더를 만든다. Deno.Command는 그룹을 만들지 않는다.
// env -i로 넘긴 이름만 자식에 남는다. 전체 환경을 복사하지 않는다.
// command와 args는 argv로 넘긴다. shell 문자열로 실행하지 않는다.
export function spawnProcess(request: SpawnRequest): Spawned {
  const assignments = Object.entries(request.env)
    .map(([key, value]) => `${shellQuote(key)}=${shellQuote(value)}`)
    .join(" ");
  const argv = [request.command, ...request.args].map(shellQuote).join(" ");
  const child = new Deno.Command("/usr/bin/setsid", {
    args: ["--fork", "/bin/sh", "-c", `exec env -i ${assignments} ${argv}`],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: { PATH: "/usr/bin:/bin" },
  }).spawn();
  const stdin = child.stdin.getWriter();
  const pid = child.pid;
  return {
    pid,
    stdin: {
      write: (bytes) => stdin.write(bytes).then(() => {}),
      close: () => stdin.close(),
    },
    stdout: fromWeb(child.stdout),
    stderr: fromWeb(child.stderr),
    exited: child.status.then((status) => status.code),
    killGroup(signal) {
      try {
        Deno.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch { /* 이미 끝난 process */ }
      }
    },
  };
}
