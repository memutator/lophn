// test runner control의 진입점이다. RequestTest 실행 구현(problems/tests#R13–R21, 실제 test 자식은
// 요청마다 띄운다)은 runner-core.ts와 app-test-run.ts에 있고, `problems.work` 반응기(problems#T19)는
// 아래 `createRunnerWorker`·`runRunnerWorker`에 있다. credential은 argv에 넣지 않는다.
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
import { TEST_RUNNER_KIND } from "./runner-core.ts";

export * from "./runner-core.ts";

// runner가 app test 한 건을 직접 돌리는 모드다. launch spec의 권한 그대로 `--app-test-job`으로 띄우면
// stdin의 요청 JSON 한 개를 돌려 결과 JSON을 stdout 한 줄로 낸다(요청을 받는 감독 통로가 이어지기 전의
// 진입점이다). 판정은 stdout 문구가 아니라 자식의 관측 frame이 정한다.
if (import.meta.main && Deno.args.includes("--app-test-job")) {
  const { runAppTestJob } = await import("./app-test-run.ts");
  const text = await new Response(Deno.stdin.readable).text();
  const done = await runAppTestJob(JSON.parse(text));
  Deno.stdout.writeSync(new TextEncoder().encode(`${JSON.stringify(done)}\n`));
  Deno.exit(0);
}

// reproduction test 한 건을 같은 방식으로 돈다(before·after를 차례로 실행한다). 요청 JSON은
// `reproduction-run.ts`의 `ReproductionJob`이다.
if (import.meta.main && Deno.args.includes("--reproduction-job")) {
  const { runReproductionJob } = await import("./reproduction-run.ts");
  const text = await new Response(Deno.stdin.readable).text();
  const done = await runReproductionJob(JSON.parse(text));
  Deno.stdout.writeSync(new TextEncoder().encode(`${JSON.stringify(done)}\n`));
  Deno.exit(0);
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
