import { assert, assertEquals } from "@std/assert";
import { spawn as spawnNode } from "node:child_process";
import {
  applyMemoryLimit,
  type MemoryProbe,
  PROCESS_MEMORY_LIMIT_BYTES,
} from "./memory-limit.ts";

const FIXTURE = new URL("./testdata/over-limit.ts", import.meta.url);

function none(): MemoryProbe {
  return {
    cgroup: () => Promise.resolve(false),
    addressSpace: () => Promise.resolve(false),
  };
}

function only(mode: "hard" | "soft"): MemoryProbe {
  return {
    cgroup: () => Promise.resolve(mode === "hard"),
    addressSpace: () => Promise.resolve(mode === "soft"),
  };
}

Deno.test("problems/tests#R20: 메모리 경계를 걸 수 없으면 시작 전에 unavailable이다", async () => {
  const limited = await applyMemoryLimit(
    "deno",
    ["run", FIXTURE.pathname],
    none(),
  );
  assert(!limited.ok);
  assertEquals(limited.error.code, "unavailable");
});

Deno.test("platform/security#R3: hard가 되면 cgroup v2 상한을 자식 argv에 넣는다", async () => {
  const limited = await applyMemoryLimit(
    "deno",
    ["run", FIXTURE.pathname],
    only("hard"),
  );
  assert(limited.ok);
  assertEquals(limited.value.mode, "hard");
  assertEquals(limited.value.command, "/usr/bin/systemd-run");
  assert(
    limited.value.args.includes(`MemoryMax=${PROCESS_MEMORY_LIMIT_BYTES}`),
  );
  assert(limited.value.args.includes("MemorySwapMax=0"));
  const marker = limited.value.args.indexOf("--");
  assert(marker > 0);
  assertEquals(limited.value.args.slice(marker + 1), [
    "deno",
    "run",
    FIXTURE.pathname,
  ]);
});

Deno.test("platform/security#R3: hard가 없으면 soft 주소 공간 상한으로 떨어진다", async () => {
  const limited = await applyMemoryLimit(
    "deno",
    ["run", FIXTURE.pathname],
    only("soft"),
  );
  assert(limited.ok);
  assertEquals(limited.value.mode, "soft");
  assertEquals(limited.value.command, "/usr/bin/prlimit");
  assert(limited.value.args.includes(`--as=${PROCESS_MEMORY_LIMIT_BYTES}`));
});

function runLimited(
  command: string,
  args: string[],
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
      const value = Deno.env.get(name);
      if (value) env[name] = value;
    }
    const child = spawnNode(command, args, {
      shell: false,
      env: { NODE_V8_COVERAGE: undefined, ...env } as unknown as Record<
        string,
        string
      >,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const take = (chunk: Uint8Array) => {
      if (out.length > 4096) return;
      out += new TextDecoder().decode(chunk);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 20_000);
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
  });
}

Deno.test("problems/tests#R20: 상한을 넘는 fixture는 실제로 죽고 survived를 남기지 않는다", async () => {
  const limited = await applyMemoryLimit(Deno.execPath(), [
    "run",
    "--allow-read",
    FIXTURE.pathname,
  ]);
  if (!limited.ok) {
    // 이 머신에서 hard도 soft도 걸 수 없다. 상한 없이 띄우지 않고 이유를 남긴다.
    console.warn(`ignore: memory limit ${limited.error.code}`);
    return;
  }
  const ran = await runLimited(limited.value.command, limited.value.args);
  assert(
    !ran.out.includes("survived"),
    `mode ${limited.value.mode} did not stop the fixture: ${ran.out}`,
  );
  assert(ran.code !== 0, `mode ${limited.value.mode} exited 0`);
});
