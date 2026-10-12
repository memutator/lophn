import { spawn as spawnNode } from "node:child_process";
import { err, ok, type Result } from "../../base/mod.ts";
import type { MemoryLimitMode } from "../../protocol/platform/mod.ts";

// problems/tests#R20. 전체 process 메모리 상한. Deno heap 상한과 별개다.
export const PROCESS_MEMORY_LIMIT_BYTES = 536_870_912;

// hard는 cgroup v2 memory.max다(platform Q10). user systemd가 scope에 컨트롤러를 위임한다.
const SYSTEMD_RUN = "/usr/bin/systemd-run";
// soft는 가상 주소 공간 상한이다. cgroup을 못 쓸 때만 쓴다.
// Deno는 512MiB RLIMIT_AS에서 시작 전에 죽는다(Oilpan 예약). /bin/true가
// 통과해도 Deno 대상에는 soft를 쓰지 않는다.
const PRLIMIT = "/usr/bin/prlimit";
const ADAPTER_MS = 2_000;

export type MemoryLimit = {
  mode: Exclude<MemoryLimitMode, "unavailable">;
  // 자식 process 전체 argv. spawnProcess와 같이 shell 없이 그대로 넘긴다.
  command: string;
  args: string[];
};

export type MemoryLimitError = {
  code: "unavailable";
  message: string;
};

export type MemoryProbe = {
  // cgroup v2 memory 컨트롤러를 이 사용자 scope에 걸 수 있는가.
  cgroup(): Promise<boolean>;
  // RLIMIT_AS를 걸 수 있는가.
  addressSpace(): Promise<boolean>;
};

// 부모 env 전체를 넘기면 NODE_V8_COVERAGE가 다시 붙는다. 세션 버스만 남긴다.
function probeEnv(): Record<string, string> {
  const env: Record<string, string> = { NODE_V8_COVERAGE: "" };
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
    const value = Deno.env.get(name);
    if (value) env[name] = value;
  }
  return env;
}

function run(
  command: string,
  args: string[],
  ms: number,
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code });
    };
    let child;
    try {
      child = spawnNode(command, args, {
        shell: false,
        env: probeEnv(),
        // stderr를 닫으면 systemd-run이 SIGPIPE로 죽는다. 읽고 버린다.
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      finish(null);
      return;
    }
    const running = child;
    running.stderr?.on("data", () => {});
    running.stderr?.on("error", () => {});
    const timer = setTimeout(() => {
      finish(null);
      try {
        running.kill("SIGKILL");
      } catch { /* 결과는 이미 실패다 */ }
    }, ms);
    running.on("error", () => finish(null));
    running.on("close", (code: number | null) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

// 프로브가 만든 scope·cgroup은 비우고 지운다. 테스트 자식을 여기에 남기지 않는다.
async function probeCgroup(): Promise<boolean> {
  const name = `lophn-memory-probe-${crypto.randomUUID()}`;
  const started = await run(SYSTEMD_RUN, [
    "--user",
    "--scope",
    `--unit=${name}`,
    "-p",
    `MemoryMax=${PROCESS_MEMORY_LIMIT_BYTES}`,
    "-p",
    "MemorySwapMax=0",
    "--collect",
    "--",
    "/bin/true",
  ], ADAPTER_MS);
  return started.code === 0;
}

async function probeAddressSpace(): Promise<boolean> {
  const started = await run(PRLIMIT, [
    `--as=${PROCESS_MEMORY_LIMIT_BYTES}`,
    "--",
    "/bin/true",
  ], ADAPTER_MS);
  return started.code === 0;
}

function isDenoTarget(command: string): boolean {
  const base = command.split("/").at(-1) ?? "";
  return base === "deno" || base.startsWith("deno.");
}

export const systemMemoryProbe: MemoryProbe = {
  cgroup: probeCgroup,
  addressSpace: probeAddressSpace,
};

// 상한을 걸 수 없으면 unavailable이다. 호출한 쪽은 그 자식을 띄우지 않는다.
export async function applyMemoryLimit(
  command: string,
  args: readonly string[],
  probe: MemoryProbe = systemMemoryProbe,
): Promise<Result<MemoryLimit, MemoryLimitError>> {
  if (command.length === 0 || args.some((arg) => arg.includes("\0"))) {
    return err({
      code: "unavailable",
      message: "memory limit command is not usable",
    });
  }
  if (await probe.cgroup()) {
    return ok({
      mode: "hard",
      command: SYSTEMD_RUN,
      args: [
        "--user",
        "--scope",
        "-p",
        `MemoryMax=${PROCESS_MEMORY_LIMIT_BYTES}`,
        "-p",
        "MemorySwapMax=0",
        "--collect",
        "--",
        command,
        ...args,
      ],
    });
  }
  // /bin/true 프로브는 Deno의 주소 공간 예약을 보지 못한다. Deno를 soft로
  // 띄우면 시작 전에 죽으므로, hard가 없으면 시작 전에 unavailable이다.
  if (isDenoTarget(command)) {
    return err({
      code: "unavailable",
      message: "deno cannot run under the soft address-space limit",
    });
  }
  if (await probe.addressSpace()) {
    return ok({
      mode: "soft",
      command: PRLIMIT,
      args: [
        `--as=${PROCESS_MEMORY_LIMIT_BYTES}`,
        "--",
        command,
        ...args,
      ],
    });
  }
  return err({
    code: "unavailable",
    message: "no process memory limit can be applied",
  });
}
