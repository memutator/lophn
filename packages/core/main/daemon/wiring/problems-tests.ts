// problems의 test runner와 그 process 안의 `problems.work`·`problems.closing` 반응기.
import { ok } from "../../../../base/mod.ts";
import { observeTestRequest } from "../../../../protocol/problems/mod.ts";
import type { InternalSubscription } from "../../../events/internal-subscription.ts";
import { createChildBlobPrepare } from "../../../storage/blobs/child-prepare.ts";
import {
  PROBLEMS_CLOSING_OP,
  startProblemsClosingFeed,
} from "../../../problems/closing/connection.ts";
import {
  PROBLEMS_WORK_FEED_CONTEXT,
  PROBLEMS_WORK_OP,
  PROBLEMS_WORK_OPERATIONS,
  PROBLEMS_WORK_PRINCIPAL,
  problemsWorkPolicies,
  startProblemsWorkFeed,
} from "../../../problems/grouping/connection.ts";
import {
  screenTestHost,
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
  // problems test runner 요청 통로. 접수된 요청 한 건을 보내고 끝맺음을 받는다. 같은
  // process의 session이 `problems.work` 깨움도 받으므로 통로 하나를 나눠 쓴다.
  const runnerChannel = createWorkerChannel();
  // 종료 때 test runner의 blob 준비와 요청 기록 읽기를 닫는다.
  let closeTestRunner: (() => void) | undefined;
  let problemsWorkFeed: InternalSubscription | undefined;
  let problemsClosingFeed: InternalSubscription | undefined;
  return {
    name: "problems-tests",
    // problems test runner(machine)가 요청 기록을 잇고 결과를 남긴다.
    // test-runner kind의 `problems.work` 반응기(machine)가 event를 읽고 문제 work를 맞춘다.
    // 같은 kind의 `problems.closing` 반응기도 CloseProblemVerified를 낸다.
    operations: () => [...testRunnerPolicies(), ...problemsWorkPolicies()],
    // problems/test-runner. 접수된 RequestTest를 정확히 한 번 시작해 실제 test 자식으로 돌리고 결과를 core command로
    // 남기는 상시 worker다. 접수 기록은 core가 주기로 읽어 요청 한 건씩 보낸다. problems를
    // 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는 계속 선다: 접수된 요청은 기록에 남고 시작하지 않는다.
    async start(ctx) {
      const runnerSpec = testRunnerSpec({
        dataRoot: ctx.root.path,
        deno: Deno.execPath(),
        screenHost: screenTestHost(),
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
      // 같은 process 안의 `problems.work` 반응기가 쓰는 machine credential이다.
      // 요청별 runner credential은 요청 본문으로 가므로 hello credential과 겹치지 않는다.
      const workIssued = await ctx.registry.issue({
        actor: "machine",
        principal: PROBLEMS_WORK_PRINCIPAL,
        scope: {
          operations: [...PROBLEMS_WORK_OPERATIONS],
          targets: { task: "problems" },
        },
        conditions: { task: "problems", process: TEST_RUNNER_KIND },
      });
      if (!workIssued.ok) {
        handler.close();
        return workIssued;
      }
      const workCurrent = ctx.registry.revalidate({
        credential_ref: workIssued.value.credential_ref,
      });
      const workRecorded = workCurrent.ok
        ? await ctx.runtime.record(workCurrent.value)
        : workCurrent;
      if (!workRecorded.ok) {
        ctx.registry.revoke(workIssued.value.credential_ref);
        handler.close();
        return workRecorded;
      }
      const started = await ctx.io.start(
        runnerSpec,
        {
          type: "hello",
          core_epoch: ctx.epoch,
          process_identity: ctx.epoch,
          kind: TEST_RUNNER_KIND,
          task: "problems",
          scope: { operations: [], targets: {} },
          // `problems.work` 반응기는 hello가 준 credential로 core loopback에 닿는다. RequestTest
          // runner service의 요별 credential은 요청 본문으로 온다(요청마다 발급해 감독 pipe로 넘긴다).
          credential: workIssued.value.token,
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
      // 구독자(machine:problems-work-feed)의 자격 기록. token이 없는 core 내부 자격이라
      // HTTP로는 이 principal이 될 수 없고, reader가 이 ledger 기록으로 구독자의 자격을 본다.
      const feedCredential = await ctx.runtime.record(
        PROBLEMS_WORK_FEED_CONTEXT,
      );
      if (!feedCredential.ok) return feedCredential;
      // `problems.work` 반응기가 도는 상시 worker다. ticket event를 읽어 문제 work·status를
      // ReconcileProblemWork로 맞춘다. 그 command를 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는
      // 계속 선다: 문제 진행 표시가 갱신되지 않을 뿐 ticket 정본은 그대로다(없는 반응을 성공으로 꾸미지
      // 않는다). runner process는 위의 RequestTest runner 감독(같은 kind)이 뜨고, 그 process의
      // session(runner-service.ts)이 `problems.work` 깨움도 받는다. 반응기 credential은 위 시작 hello에
      // 심고, 깨움 요청은 같은 runnerChannel로 간다.
      if (
        ctx.allRoutes.some((route) =>
          route.name === PROBLEMS_WORK_OPERATIONS[2]
        )
      ) {
        // ticket event가 오면 worker가 cursor 뒤를 따라잡는다. 구독이 열릴 때와 주기마다도 깨워
        // 재시작·worker 교체 동안의 변화를 따라잡는다.
        problemsWorkFeed = startProblemsWorkFeed({
          runtime: ctx.runtime,
          ledgerPath: ctx.ledgerPath,
          wake: (cursor) =>
            runnerChannel.request(PROBLEMS_WORK_OP, { cursor }, 30_000),
        });
        // 같은 runner 안의 `problems.closing` 반응기는 worker의 machine credential(위 발급)로
        // cursor 뒤 closing event를 따라잡는다. 조건 판정은 command가 정본에서
        // 다시 한다. 이 구독자는 깨움 신호만 낸다.
        problemsClosingFeed = startProblemsClosingFeed({
          runtime: ctx.runtime,
          ledgerPath: ctx.ledgerPath,
          wake: (cursor) =>
            runnerChannel.request(PROBLEMS_CLOSING_OP, { cursor }, 30_000),
        });
      }
      return ok(undefined);
    },
    closeIntake() {
      problemsWorkFeed?.stop();
      problemsClosingFeed?.stop();
      closeTestRunner?.();
    },
  };
};
