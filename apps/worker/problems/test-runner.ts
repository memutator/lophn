// test runner control. core 감독이 하나를 띄우고, 실제 test 자식은 요청마다
// 이 모듈이 띄운다(problems/tests#R13–R21). credential은 argv에 넣지 않는다.
import { applyMemoryLimit } from "../../../packages/platform/security/mod.ts";
import {
  brokerReport,
  type MemoryLimitPort,
  type ReportSink,
  runPrepared,
  type RunRequest,
  type RunVerdict,
  type StartAttemptCommit,
} from "../../../packages/problems/tests/work/mod.ts";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type {
  ParentMessage,
  WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createWorkPorts,
  type WorkClientOptions,
} from "../../../packages/problems/grouping/adapters/core-client.ts";
import {
  reactWork,
  type WorkReactionPorts,
} from "../../../packages/problems/grouping/work.ts";

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
  options: {
    memory?: MemoryLimitPort;
    // ledger에 시작 시도를 확정한다. ok가 아니면 자식을 띄우지 않는다(R17).
    commit?: StartAttemptCommit;
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
    commit: options.commit,
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

export function runnerReady(kind: string): Result<true> {
  if (kind !== TEST_RUNNER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

// core가 감독 pipe로 보내는 깨움 요청의 op. 본문은 cursor 하나다: core가 ledger의 `problems.work`
// 처리 위치를 읽어 싣고, 상태는 그 뒤 event와 정본에서 다시 읽는다.
export const PROBLEMS_WORK_OP = "problems.work";

function requestOf(message: ParentMessage): WorkerRequest | undefined {
  const record = message as unknown as Record<string, unknown>;
  return record["type"] === "worker_request" &&
      typeof record["request_id"] === "string" &&
      typeof record["op"] === "string"
    ? message as unknown as WorkerRequest
    : undefined;
}

export type RunnerWorkerOptions = {
  streams: ChildStreams;
  // hello가 준 machine credential과 core api port로 반응 통로를 만든다.
  ports(position: { credential: string; api_port: number }): WorkReactionPorts;
};

// test-runner kind 안의 `problems.work` 반응기(problems/grouping#R9). 요청은 한 번에 하나씩 차례로
// 처리한다. 성공한 위치는 기억해 더 낡은 깨움의 cursor로 되돌아가지 않고, 실패하면 기억을 버려 다음
// 깨움이 정본 위치를 준다.
export function createRunnerWorker(options: RunnerWorkerOptions): ChildSession {
  let ports: WorkReactionPorts | undefined;
  let known: string | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== TEST_RUNNER_KIND) {
        throw new Error("invalid worker kind");
      }
      ports = options.ports({
        credential: hello.credential,
        api_port: hello.api_port,
      });
      return session.send({ type: "ready" });
    },
    onStop() {
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      const request = requestOf(message);
      if (request === undefined) return;
      const fail = (code: "invalid_input" | "unavailable", text: string) =>
        session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: { code, message: text },
        });
      const cursor = (request.payload as { cursor?: unknown } | null)?.cursor;
      if (request.op !== PROBLEMS_WORK_OP) {
        await fail("invalid_input", "unknown runner op");
        return;
      }
      if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) {
        await fail("invalid_input", "cursor is not a seq");
        return;
      }
      const mine = ports;
      if (mine === undefined) {
        await fail("unavailable", "runner has no credential");
        return;
      }
      const run = chain.then(async () => {
        const from = known !== undefined && BigInt(known) > BigInt(cursor)
          ? known
          : cursor;
        const done = await reactWork(mine, from);
        known = done.ok ? done.value.processed_through_seq : undefined;
        return done;
      });
      chain = run.catch(() => undefined);
      const done = await run;
      await (done.ok
        ? session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: true,
          payload: done.value,
        })
        : fail("unavailable", "problems work reaction failed"));
    },
  });
  return session;
}

export async function runRunnerWorker(_root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = createRunnerWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    ports: (position) =>
      createWorkPorts(
        {
          baseUrl: `http://127.0.0.1:${position.api_port}`,
          credential: position.credential,
          // EXTERNAL_FETCH tripwire: property access로만 부른다.
          fetch: (input, init) => {
            const globalFetch = globalThis.fetch;
            return globalFetch(input, init).then(async (response) => ({
              status: response.status,
              bytes: new Uint8Array(await response.arrayBuffer()),
            }));
          },
        } satisfies WorkClientOptions,
      ),
  });
  await session.run();
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다.
if (import.meta.main) {
  await runRunnerWorker(Deno.env.get("LOPHN_HOME") ?? "");
}
