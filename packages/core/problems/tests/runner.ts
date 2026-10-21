// test runner launch spec. core 등록이 이 모듈만 import한다.
// 실행 구현(problems/tests/work)은 worker가 import하고 core graph에는 두지 않는다.
import type { KindLaunchSpec } from "../../../protocol/supervision/mod.ts";
import { checkLaunchSpec } from "../../supervision/security/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";

// runner가 동시에 도는 두 요청이 나눠 쓰는 고정 socket slot이다. Deno는 Unix socket 듣기·연결에 정확한
// 경로의 net 허락을 요구하므로 요청마다 만든 경로가 아니라 이 slot의 경로만 쓴다.
const RUNNER_SLOTS = [0, 1] as const;

function runnerSockets(
  dataRoot: string,
  slot: (typeof RUNNER_SLOTS)[number],
): { broker: string; control: string } {
  const base = `${dataRoot}/work/problems/tests/sock`;
  return {
    broker: `${base}/${slot}-b.sock`,
    control: `${base}/${slot}-a.sock`,
  };
}

// 메모리 상한(systemd-run·prlimit)과 프로세스 그룹(setsid)을 거는 platform 도구다. runner가 자식을
// 띄우는 길이라 정확한 절대 경로만 --allow-run에 더한다(platform/security).
// 그룹 도구는 실제로 있는지 `Deno.stat`으로 확인하므로 읽기도 그 경로만 허락한다.
const GROUP_TOOLS = ["/usr/bin/setsid", "/usr/bin/perl"] as const;

const LIMIT_TOOLS = [
  "/usr/bin/setsid",
  "/usr/bin/systemd-run",
  "/usr/bin/prlimit",
] as const;

// runner control은 플랫폼 code다. 준비 폴더와 작업 root만 읽고 쓰고, 승인된 Deno 실행 파일과 자식을
// 거는 platform 도구만 --allow-run으로 받는다. net은 고정 socket 경로와 가상 host,
// core loopback(요청별 machine credential으로 command를 부른다)뿐이다.
export function testRunnerSpec(input: {
  dataRoot: string;
  deno: string;
}): KindLaunchSpec | undefined {
  if (!input.dataRoot.startsWith("/") || !input.deno.startsWith("/")) {
    return undefined;
  }
  const work = `${input.dataRoot}/work/problems/tests`;
  const entry = new URL(
    "../../main/worker/test-runner.ts",
    import.meta.url,
  ).pathname;
  const rootConfig = new URL("../../../../deno.json", import.meta.url).pathname;
  const sockets = RUNNER_SLOTS.flatMap((slot) =>
    Object.values(runnerSockets(input.dataRoot, slot)).map((path) =>
      `unix:${path}`
    )
  );
  const spec: KindLaunchSpec = {
    kind: TEST_RUNNER_KIND,
    entry,
    allow_read: [input.dataRoot, entry, rootConfig, ...GROUP_TOOLS],
    allow_write: [work],
    // 고정 socket 경로와 가상 host(Unix socket은 정확한 경로의 net 허락을 요구한다)와
    // core loopback(runner service가 요청을 받아 core command로 남긴다)을 모두 허락한다.
    allow_net: ["lophn.invalid", "127.0.0.1", ...sockets],
    allow_run: [input.deno, ...LIMIT_TOOLS],
    allow_sys: [],
    allow_env: [
      "LOPHN_HOME",
      "LOPHN_WORKER_KIND",
      "HOME",
      "DENO_DIR",
      "XDG_CACHE_HOME",
      "PATH",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
      "NODE_V8_COVERAGE",
    ],
    policy: "always",
    memory_limit_bytes: 536_870_912,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}
