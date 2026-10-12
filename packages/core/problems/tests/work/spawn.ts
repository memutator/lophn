import { err, ok, type Result } from "../../../../base/mod.ts";
import type { MemoryLimitMode } from "../../../../protocol/server/mod.ts";
import { childLaunch } from "./broker.ts";
import { groupLeader } from "./group.ts";
import { RUNNER_LIMITS } from "./limits.ts";
import type { PreparedCommand } from "./prepare.ts";

export type ChildHandle = {
  pid: number;
  stdin: WritableStream<Uint8Array> | null;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  // timeout·복구는 이 프로세스 그룹 전체를 죽인다. prlimit·systemd-run 뒤의
  // Deno와 그 손자까지 회수한다(problems/tests#R20).
  killGroup(signal?: Deno.Signal): void;
  status(): Promise<Deno.CommandStatus>;
};

export type SpawnPort = {
  spawn(command: string, args: string[], options: {
    cwd: string;
    env: Record<string, string>;
  }): ChildHandle;
};

// platform/security applyMemoryLimit와 같은 모양. problems는 그 구현을
// import하지 않고 runner가 넘긴다(problems/tests#R20).
export type MemoryLimitPort = {
  limit(
    command: string,
    args: readonly string[],
  ): Promise<
    Result<{
      mode: Exclude<MemoryLimitMode, "unavailable">;
      command: string;
      args: string[];
    }>
  >;
};

export type RunningChild = {
  mode: Exclude<MemoryLimitMode, "unavailable">;
  pid: number;
  command: string;
  args: string[];
  started_at: string;
  killGroup(signal?: Deno.Signal): void;
  finished(): Promise<ChildOutcome>;
};

export type ChildOutcome = {
  end_reason: "exited" | "timeout" | "killed";
  exit_code: number | null;
  // 안전 출력. 상한을 넘으면 truncated이고 원문 전체는 보관하지 않는다.
  output: Uint8Array;
  truncated: boolean;
  ended_at: string;
};

const UNAVAILABLE = "프로세스 메모리 경계를 강제할 수 없다";

function killGroup(pid: number, signal: Deno.Signal = "SIGKILL"): void {
  // 새 세션의 리더라 그룹 id가 pid와 같다. 음수 pid는 그 그룹 전체다.
  Deno.kill(-pid, signal);
}

async function systemSpawn(os: string): Promise<SpawnPort | null> {
  // 그룹을 나눌 수 없으면 null이다. 호출한 쪽이 자식을 띄우지 않고 unavailable로 돌린다.
  const leader = await groupLeader(os);
  if (!leader) return null;
  return {
    spawn(command, args, options) {
      // 리더가 새 프로세스 그룹을 연다. timeout은 그 그룹을 통째로 죽인다.
      const child = new Deno.Command(leader.command, {
        args: [...leader.args, command, ...args],
        cwd: options.cwd,
        env: options.env,
        clearEnv: true,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      return {
        pid: child.pid,
        stdin: null,
        stdout: child.stdout,
        stderr: child.stderr,
        killGroup: (signal) => killGroup(child.pid, signal),
        status: () => child.status,
      };
    },
  };
}

async function drain(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
  into: { bytes: Uint8Array[]; total: number; truncated: boolean },
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      into.total += next.value.byteLength;
      if (into.truncated) continue;
      const used = into.bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const room = cap - used;
      if (next.value.byteLength <= room) {
        into.bytes.push(next.value);
      } else {
        if (room > 0) into.bytes.push(next.value.subarray(0, room));
        into.truncated = true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// 시작 시도가 ledger에 확정된 뒤에만 부른다(problems/tests#R17).
// 메모리 경계를 걸 수 없으면 자식을 띄우지 않고 unavailable이다(problems/tests#R20).
export async function startChild(
  prepared: PreparedCommand,
  options: {
    memory?: MemoryLimitPort;
    spawn?: SpawnPort;
    now?: () => string;
    outputCap?: number;
    // 그룹을 나누는 도구를 고르는 OS. 테스트가 넘기고, 없으면 이 머신이다.
    os?: string;
  } = {},
): Promise<Result<RunningChild>> {
  if (!options.memory) {
    return err({ code: "unavailable", message: UNAVAILABLE });
  }
  const limited = await options.memory.limit(
    prepared.executable,
    prepared.args,
  );
  if (!limited.ok) {
    return err({ code: "unavailable", message: UNAVAILABLE });
  }
  // 자식은 core·collector 주소와 credential을 받지 않는다(problems/tests#R17).
  const launch = childLaunch(limited.value.args, prepared.env);
  if (!launch.ok) return launch;
  const spawn = options.spawn ?? await systemSpawn(options.os ?? Deno.build.os);
  if (!spawn) return err({ code: "unavailable", message: UNAVAILABLE });
  const cap = options.outputCap ?? RUNNER_LIMITS.output_bytes_per_side;
  let child: ChildHandle;
  try {
    child = spawn.spawn(limited.value.command, launch.value.args, {
      cwd: prepared.cwd,
      env: launch.value.env,
    });
  } catch {
    return err({ code: "unavailable", message: UNAVAILABLE });
  }
  const started = (options.now ?? (() => new Date().toISOString()))();
  const stdout = {
    bytes: [] as Uint8Array[],
    total: 0,
    truncated: false,
  };
  const stderr = {
    bytes: [] as Uint8Array[],
    total: 0,
    truncated: false,
  };
  // side마다 stdout·stderr가 각각 1,048,576 bytes다. 넘으면 자르고 계속 읽는다.
  const drained = Promise.all([
    drain(child.stdout, cap, stdout),
    drain(child.stderr, cap, stderr),
  ]);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.killGroup("SIGKILL");
      } catch { /* 이미 끝났을 수 있다 */ }
      resolve("timeout");
    }, prepared.timeout_ms);
  });
  const finished = async (): Promise<ChildOutcome> => {
    const status = child.status();
    const reason = await Promise.race([
      status.then(() => "done" as const),
      timed,
    ]);
    if (timer !== undefined) clearTimeout(timer);
    const ended = await status.catch(() => ({
      success: false,
      code: 1,
      signal: null,
    }));
    await drained;
    const kept = [...stdout.bytes, ...stderr.bytes];
    const output = new Uint8Array(
      kept.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    );
    let offset = 0;
    for (const chunk of kept) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      end_reason: reason === "timeout" || timedOut
        ? "timeout"
        : ended.signal
        ? "killed"
        : "exited",
      exit_code: reason === "timeout" || timedOut ? null : ended.code,
      output,
      truncated: stdout.truncated || stderr.truncated,
      ended_at: new Date().toISOString(),
    };
  };
  return ok({
    mode: limited.value.mode,
    pid: child.pid,
    command: limited.value.command,
    args: limited.value.args,
    started_at: started,
    killGroup: (signal) => child.killGroup(signal),
    finished,
  });
}
