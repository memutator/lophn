// problems의 test runner. 접수된 RequestTest를 정확히 한 번 시작해 실제 test 자식으로 돌리고 결과를
// core command로 남기는 상시 worker다.
import { ok } from "../../../../base/mod.ts";
import { observeTestRequest } from "../../../../protocol/problems/mod.ts";
import { createChildBlobPrepare } from "../../../storage/blobs/child-prepare.ts";
import {
  TEST_RUNNER_KIND,
  testRunnerSpec,
} from "../../../problems/tests/runner.ts";
import {
  startTestControl,
  type TestControl,
  testRunnerBlobPolicy,
  testRunnerPolicies,
} from "../../../problems/tests/control.ts";
import { createWorkerChannel, type WiringFactory } from "./context.ts";

export const problemsTestsWiring: WiringFactory = () => {
  // problems test runner 요청 통로. 접수된 요청 한 건을 보내고 끝맺음을 받는다.
  const runnerChannel = createWorkerChannel();
  // 종료 때 test runner의 blob 준비와 요청 기록 읽기를 닫는다.
  let closeTestRunner: (() => void) | undefined;
  return {
    name: "problems-tests",
    // problems test runner(machine)가 요청 기록을 잇고 결과를 남긴다.
    operations: () => testRunnerPolicies(),
    // 접수 기록은 core가 주기로 읽어 요청 한 건씩 보낸다. problems를 등록하지 않은 조립은 띄우지 않는다.
    // 띄우지 못해도 core는 계속 선다: 접수된 요청은 기록에 남고 시작하지 않는다.
    async start(ctx) {
      const runnerSpec = testRunnerSpec({
        dataRoot: ctx.root.path,
        deno: Deno.execPath(),
      });
      if (
        !runnerSpec ||
        !ctx.assembled.commands.some((command) =>
          command.route.name === observeTestRequest.name
        )
      ) return ok(undefined);
      // deno-lint-ignore prefer-const
      let testControl: TestControl | undefined;
      const handler = createChildBlobPrepare({
        kind: TEST_RUNNER_KIND,
        gauge: ctx.blobBuffer,
        send: (message) =>
          ctx.io.send(TEST_RUNNER_KIND, message).then((sent) => sent.ok),
        prepareBlob: (call) => ctx.blobRelay.prepare(call),
        // 준비 참조의 주체는 지금 맡은 일의 runner 주체다(결과를 쓰는 자격의 주체와 같아야 등록된다).
        policies: new Map([[
          TEST_RUNNER_KIND,
          testRunnerBlobPolicy(() =>
            testControl?.blobPrincipal() ?? "problems-test-runner"
          ),
        ]]),
      });
      const started = await ctx.io.start(
        runnerSpec,
        {
          type: "hello",
          core_epoch: ctx.epoch,
          process_identity: ctx.epoch,
          kind: TEST_RUNNER_KIND,
          task: "problems",
          scope: { operations: [], targets: {} },
          // runner는 자기 credential이 없다. 요청마다 발급한 credential은 요청 본문으로 감독 pipe를 통해 온다.
          credential: "none",
          api_port: ctx.server.port,
        },
        {
          onMessage: (message) => {
            if (!handler.onMessage(message)) runnerChannel.onMessage(message);
          },
          onFrame: (frame) => handler.onFrame(frame),
          onEnd: () => testControl?.runnerEnded(),
        },
      );
      if (!started.ok) {
        handler.close();
        return ok(undefined);
      }
      runnerChannel.bind((payload) =>
        ctx.io.send(TEST_RUNNER_KIND, payload).then((sent) => sent.ok)
      );
      testControl = startTestControl({
        ledgerPath: ctx.ledgerPath,
        channel: runnerChannel,
        apiPort: ctx.server.port,
        // 요청마다 credential을 발급해 ledger에 기록한다. 쓴 뒤에는 폐기한다.
        issue: async (input) => {
          const issued = await ctx.registry.issue(input);
          if (!issued.ok) return issued;
          const current = ctx.registry.revalidate({
            credential_ref: issued.value.credential_ref,
          });
          const recorded = current.ok
            ? await ctx.runtime.record(current.value)
            : current;
          if (!recorded.ok) {
            ctx.registry.revoke(issued.value.credential_ref);
            return recorded;
          }
          return ok({
            token: issued.value.token,
            revoke: () => {
              ctx.registry.revoke(issued.value.credential_ref);
            },
          });
        },
      });
      closeTestRunner = () => {
        testControl?.stop();
        handler.close();
      };
      return ok(undefined);
    },
    closeIntake() {
      closeTestRunner?.();
    },
  };
};
