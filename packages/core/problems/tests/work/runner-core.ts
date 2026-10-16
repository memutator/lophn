// test runner control. core 감독이 하나를 띄우고, 실제 test 자식은 요청마다
// 이 모듈이 띄운다. credential은 argv에 넣지 않는다.
import { applyMemoryLimit } from "../../../supervision/security/mod.ts";
import {
  type MemoryLimitPort,
  type RunningChild,
  runPrepared,
  type RunRequest,
  type RunVerdict,
  type StartAttemptCommit,
} from "./mod.ts";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type AppTestInput,
  generateAppTestChecks,
  judgeAppTest,
} from "../app-test/mod.ts";
import type { SpawnPort } from "./mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";

// 감독이 runner를 거두면 띄워 둔 프로세스 그룹을 전부 회수한다.

// 메모리 경계는 platform/security가 고른다. 걸 수 없으면 runPrepared가
// 자식을 띄우지 않는다.
export const platformMemory: MemoryLimitPort = {
  limit(command, args) {
    return applyMemoryLimit(command, args);
  },
};

async function acceptRun(
  request: RunRequest,
  options: {
    memory?: MemoryLimitPort;
    spawn?: SpawnPort;
    // ledger에 시작 시도를 확정한다. ok가 아니면 자식을 띄우지 않는다.
    commit?: StartAttemptCommit;
    // 자식이 실제로 시작한 직후 부른다(실제 시작을 ledger에 남기는 때).
    started?: (
      child: { started_at: string; mode: RunningChild["mode"] },
    ) => Promise<void>;
  } = {},
): Promise<Result<RunVerdict>> {
  if (request.prepare.env && "LOPHN_HOME" in request.prepare.env) {
    return err({
      code: "invalid_input",
      message: "자식 환경에 홈을 넘기지 않는다",
    });
  }
  return await runPrepared(request, {
    memory: options.memory ?? platformMemory,
    spawn: options.spawn,
    commit: options.commit,
    started: options.started,
  });
}

// 고정 app-test 계획과 scratch의 private 관측을 lifecycle 결과와 함께 판정한다.
export async function acceptAppTest(
  request: RunRequest,
  input: AppTestInput,
  options: Parameters<typeof acceptRun>[1] = {},
) {
  if (request.side !== "single" || request.test_hash !== input.test_hash) {
    return err({ code: "invalid_input", message: "app test 대상이 다르다" });
  }
  const execution = await acceptRun(request, options);
  if (!execution.ok) return execution;
  const judgment = judgeAppTest({
    plan: generateAppTestChecks(input),
    test_hash: input.test_hash,
    frames: execution.value.frames,
  });
  if (execution.value.result !== "pass") {
    judgment.result = execution.value.result;
    judgment.reason = execution.value.reason;
  }
  return ok({ execution: execution.value, judgment });
}

export function runnerReady(kind: string): Result<true> {
  if (kind !== TEST_RUNNER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}
