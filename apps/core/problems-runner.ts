// test runner launch spec. core 등록이 이 모듈만 import한다.
// 실행 구현(problems/tests/work)은 worker가 import하고 core graph에는 두지 않는다.
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { checkLaunchSpec } from "../../packages/platform/security/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";
export const COLLECTOR_KIND = "problems/report-collector";

// runner control은 플랫폼 code다. 준비 폴더와 작업 root만 읽고 쓰고,
// 승인된 Deno 실행 파일만 --allow-run으로 받는다(architecture/problems 2.2).
export function testRunnerSpec(input: {
  dataRoot: string;
  deno: string;
}): KindLaunchSpec | undefined {
  if (!input.dataRoot.startsWith("/") || !input.deno.startsWith("/")) {
    return undefined;
  }
  const work = `${input.dataRoot}/work/problems/tests`;
  const entry = new URL(
    "../worker/problems/test-runner.ts",
    import.meta.url,
  ).pathname;
  const spec: KindLaunchSpec = {
    kind: TEST_RUNNER_KIND,
    entry,
    allow_read: [input.dataRoot, entry],
    allow_write: [work],
    allow_net: [],
    allow_run: [input.deno],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
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
