// test runner control. core 감독이 하나를 띄우고, 실제 test 자식은 요청마다
// 이 모듈이 띄운다(problems/tests#R13–R21). credential은 argv에 넣지 않는다.
import { applyMemoryLimit } from "../../../packages/core/supervision/security/mod.ts";
import {
  brokerReport,
  type MemoryLimitPort,
  type ReportSink,
  type RunningChild,
  runPrepared,
  type RunRequest,
  type RunVerdict,
  type StartAttemptCommit,
} from "../../../packages/core/problems/tests/work/mod.ts";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import {
  type AppTestInput,
  generateAppTestChecks,
  judgeAppTest,
  openViewDriver,
  type ScreenReportSink,
} from "../../../packages/core/problems/tests/app-test/mod.ts";
import {
  runScreenHost,
  screenErrorBoundaries,
} from "../../../packages/core/problems/tests/adapters/screen-host.ts";
import {
  serveTestAppSocket,
  type TestAppInvoke,
} from "../../../packages/core/problems/tests/adapters/test-app-socket.ts";
import type { ScreenTestInput } from "../../../packages/protocol/shell/mod.ts";
import type { SpawnPort } from "../../../packages/core/problems/tests/work/mod.ts";

export const TEST_RUNNER_KIND = "problems/test-runner";

// core가 감독 pipe로 보내는 `problems.work` 깨움 요청의 op. 본문은 cursor 하나다: core가 ledger의
// `problems.work` 처리 위치를 읽어 싣고, 상태는 그 뒤 event와 정본에서 다시 읽는다(problems#T19).
export const PROBLEMS_WORK_OP = "problems.work";

// 같은 runner service가 도는 `problems.closing` 반응기(problems#T20)의 깨움 op다. 본문은 cursor 하나다.
export const PROBLEMS_CLOSING_OP = "problems.closing";

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
  options: {
    memory?: MemoryLimitPort;
    spawn?: SpawnPort;
    // ledger에 시작 시도를 확정한다. ok가 아니면 자식을 띄우지 않는다(R17).
    commit?: StartAttemptCommit;
    // 자식이 실제로 시작한 직후 부른다(실제 시작을 ledger에 남기는 자리).
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

// 자식의 private IPC 보고를 그 요청의 mode=test·scope로 collector에 넘긴다.
// 자식은 collector 주소를 받지 않는다(problems/tests#R17).
export function forwardChildReport(
  frame: Uint8Array,
  scope: string,
  sink: ReportSink,
): Promise<Result<unknown>> {
  return brokerReport(frame, scope, sink);
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

// 요청 폴더의 socket과 설치 host를 이어 준다. host가 내는 오류는 collector가
// mode=test·scope로 접수한 뒤에만 ViewDriver 근거가 된다.
export async function runnerView(input: {
  command?: string;
  args?: readonly string[];
  work_dir: string;
  screens: Omit<ScreenTestInput, "app_socket_path" | "probe_nonce">;
  invoke: TestAppInvoke;
  // test 앱 socket의 경로. runner launch spec이 정확한 경로만 허락하므로 호출한 쪽이 정한다.
  socket_path?: string;
  sink: ScreenReportSink;
  scope: string;
  nonce: string;
  newReportId: () => string;
  now: () => string;
}) {
  const socket = serveTestAppSocket({
    path: input.socket_path ?? `${input.work_dir}/app.sock`,
    invoke: input.invoke,
  });
  try {
    const screens = { ...input.screens, app_socket_path: socket.path };
    const boundaries = await screenErrorBoundaries(screens);
    const command = input.command ?? Deno.env.get("SCREEN_TEST_HOST");
    return await openViewDriver({
      nonce: input.nonce,
      run: (nonce) =>
        command
          ? runScreenHost({
            command,
            args: input.args,
            work_dir: input.work_dir,
            input: { ...screens, probe_nonce: nonce },
          })
          : Promise.resolve({
            kind: "unavailable",
            reason: "화면 host가 없다",
          }),
      has_boundary: (screen) => boundaries.has(screen),
      sink: input.sink,
      scope: input.scope,
      newReportId: input.newReportId,
      now: input.now,
    });
  } finally {
    await socket.shutdown();
  }
}

export function runnerReady(kind: string): Result<true> {
  if (kind !== TEST_RUNNER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}
