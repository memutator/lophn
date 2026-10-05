// test runner control. core 감독이 하나를 띄우고, 실제 test 자식은 요청마다
// 이 모듈이 띄운다(problems/tests#R13–R21). credential은 argv에 넣지 않는다.
import { applyMemoryLimit } from "../../../packages/platform/security/mod.ts";
import {
  type MemoryLimitPort,
  runPrepared,
  type RunRequest,
  type RunVerdict,
} from "../../../packages/problems/tests/work/mod.ts";
import { err, ok, type Result } from "../../../packages/base/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";

export type RunnerChild = {
  pid: number;
  killGroup(signal?: Deno.Signal): void;
};

// 감독이 runner를 거두면 띄워 둔 프로세스 그룹을 전부 회수한다.
export function stopChildren(children: readonly RunnerChild[]): void {
  for (const child of children) {
    try {
      child.killGroup("SIGKILL");
    } catch { /* 이미 끝난 자식은 무시한다 */ }
  }
}

// 메모리 경계는 platform/security가 고른다. 걸 수 없으면 runPrepared가
// 자식을 띄우지 않는다(problems/tests#R20).
export const platformMemory: MemoryLimitPort = {
  limit(command, args) {
    return applyMemoryLimit(command, args);
  },
};

export async function acceptRun(
  request: RunRequest,
  options: { memory?: MemoryLimitPort } = {},
): Promise<Result<RunVerdict>> {
  if (request.prepare.env && "LOPHN_HOME" in request.prepare.env) {
    return err({
      code: "invalid_input",
      message: "자식 환경에 홈을 넘기지 않는다",
    });
  }
  return await runPrepared(request, {
    memory: options.memory ?? platformMemory,
  });
}

export function runnerReady(kind: string): Result<true> {
  if (kind !== TEST_RUNNER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}
