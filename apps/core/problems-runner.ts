// test runner launch spec. core 등록이 이 모듈만 import한다.
// 실행 구현(problems/tests/work)은 worker가 import하고 core graph에는 두지 않는다.
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { checkLaunchSpec } from "../../packages/platform/security/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";
export const COLLECTOR_KIND = "problems/report-collector";

// runner가 동시에 도는 두 요청이 나눠 쓰는 고정 socket 자리다. Deno는 Unix socket 듣기·연결에 정확한
// 경로의 net 허락을 요구하므로 요청마다 만든 경로가 아니라 이 자리만 쓴다.
export const RUNNER_SLOTS = [0, 1] as const;

export function runnerSockets(
  dataRoot: string,
  slot: (typeof RUNNER_SLOTS)[number],
): { broker: string; direct: string; probe: string } {
  const base = `${dataRoot}/work/problems/tests/sock`;
  return {
    broker: `${base}/${slot}-b.sock`,
    direct: `${base}/${slot}-a.sock`,
    probe: `${base}/${slot}-p.sock`,
  };
}

// 메모리 상한(systemd-run·prlimit)과 프로세스 그룹(setsid)을 거는 platform 도구다. runner가 자식을
// 띄우는 길이라 정확한 절대 경로만 --allow-run에 더한다(platform/security, problems/tests#R20).
// 그룹 도구는 실제로 있는지 `Deno.stat`으로 확인하므로 읽기도 그 경로만 허락한다.
const GROUP_TOOLS = ["/usr/bin/setsid", "/usr/bin/perl"] as const;

const LIMIT_TOOLS = [
  "/usr/bin/setsid",
  "/usr/bin/systemd-run",
  "/usr/bin/prlimit",
] as const;

// runner control은 플랫폼 code다. 준비 폴더와 작업 root만 읽고 쓰고, 승인된 Deno 실행 파일과 자식을
// 거는 platform 도구, 화면 검사 host만 --allow-run으로 받는다(architecture/problems 2.2). net은 고정
// socket 자리와 가상 host뿐이다.
export function testRunnerSpec(input: {
  dataRoot: string;
  deno: string;
  screenHost?: string;
}): KindLaunchSpec | undefined {
  if (
    !input.dataRoot.startsWith("/") || !input.deno.startsWith("/") ||
    (input.screenHost !== undefined && !input.screenHost.startsWith("/"))
  ) {
    return undefined;
  }
  const work = `${input.dataRoot}/work/problems/tests`;
  const entry = new URL(
    "../worker/problems/test-runner.ts",
    import.meta.url,
  ).pathname;
  const rootConfig = new URL("../../deno.json", import.meta.url).pathname;
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
    allow_net: ["lophn.invalid", ...sockets],
    allow_run: [
      input.deno,
      ...LIMIT_TOOLS,
      ...(input.screenHost ? [input.screenHost] : []),
    ],
    allow_sys: [],
    allow_env: [
      "LOPHN_HOME",
      "LOPHN_WORKER_KIND",
      "SCREEN_TEST_HOST",
      "HOME",
      "DENO_DIR",
      "XDG_CACHE_HOME",
      "PATH",
      "DISPLAY",
      "XAUTHORITY",
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

// report collector는 준비 폴더의 bundle 사본과 blueprint만 읽고, core loopback에만
// 닿는다(architecture/problems 2.2). 쓰기·자식 실행 권한은 없다.
export function reportCollectorSpec(input: {
  dataRoot: string;
}): KindLaunchSpec | undefined {
  if (!input.dataRoot.startsWith("/")) {
    return undefined;
  }
  const entry = new URL(
    "../worker/problems/report-collector.ts",
    import.meta.url,
  ).pathname;
  // architecture 2.2: --allow-read는 읽기 전용 준비 폴더뿐이다. bundle 사본은
  // `apps/<app ID>/bundles/<bundle hash>/`의 파일 0444다(releases/bundle/seal.ts),
  // 등록 시점 spec은 credential의 bundle_hash로 찾는 그 부모 폴더만 이름 짓는다.
  // ledger·blob store는 직접 열지 않는다. FFI는 launchArgv가 플래그를 내지 않는다.
  const bundles = `${input.dataRoot}/apps`;
  const spec: KindLaunchSpec = {
    kind: COLLECTOR_KIND,
    entry,
    allow_read: [bundles],
    allow_write: [],
    allow_net: ["127.0.0.1"],
    allow_run: [],
    allow_sys: [],
    // 환경은 명시한 안전 변수만: 띄운 뒤 root·kind를 읽는 것뿐이다. HOME·PATH는
    // supervisor env callback이 프로세스 env로만 넘기고 Deno는 permission 없이
    // OS env에서 캐시 위치를 찾는다.
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 268_435_456,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}
