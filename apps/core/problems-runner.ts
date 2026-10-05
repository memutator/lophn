// test runner launch spec. core 등록이 이 모듈만 import한다.
// 실행 구현(problems/tests/work)은 worker가 import하고 core graph에는 두지 않는다.
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { checkLaunchSpec } from "../../packages/platform/security/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";

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
