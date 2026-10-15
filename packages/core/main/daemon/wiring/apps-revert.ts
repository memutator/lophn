import { ok } from "../../../../base/mod.ts";
import { runAppRevert } from "../../../../protocol/lophn-agent/mod.ts";
import {
  APP_REVERT_CONTEXT,
  createAppRevert,
} from "../../../apps/revert/app-steps.ts";
import {
  REVERT_WORKER_KIND,
  revertWorkerSpec,
  workerAppCaller,
} from "../../../apps/revert/caller.ts";
import { appSocketRoot } from "../../../apps/control.ts";
import { createWorkerChannel, type WiringFactory } from "./context.ts";

export const appsRevertWiring: WiringFactory = () => {
  // 앱 revert 호출 worker 요청 통로. 같은 통로 모양을 쓴다(lophn-agent/revert).
  const revertChannel = createWorkerChannel();
  return {
    name: "apps-revert",
    // 앱 revert 이어 실행(lophn-agent/revert)이 단계를 기록하고 끝내는 core 내부 자격 기록.
    records: () => [APP_REVERT_CONTEXT],
    build(ctx) {
      const files = ctx.rewindFiles;
      return ok({
        memory: [[
          // 확인한 revert의 앱 단계를 이어 실행한다(lophn-agent/revert). 실제 복원 호출은 감독
          // worker(apps/revert)가 호출자의 credential으로 하고 core는 결과를 받아 판정한다.
          `${runAppRevert.resource}/${runAppRevert.method}`,
          createAppRevert({
            snapshot: files.snapshot,
            rootOf: files.rootOf,
            answeredFacts: files.answeredFacts,
            store: files.store,
            caller: (_ctx, credential) =>
              workerAppCaller({
                channel: revertChannel,
                credential,
              }),
            writer: () => ctx.runtime.writer,
          }),
        ]],
      });
    },
    // apps/revert. 확인한 revert의 앱 단계를 호출자의 credential로 실제로 부르는 상시 worker다
    // (lophn-agent/revert). 띄우지 못해도 core는 계속 선다:
    // 사람의 RunAppRevert 이어 실행이 failure로 닿지 않는다(접수는 applying으로 남는다).
    async start(ctx) {
      const started = await ctx.io.start(
        revertWorkerSpec({ socketRoot: appSocketRoot() }),
        {
          type: "hello",
          core_epoch: ctx.epoch,
          process_identity: ctx.epoch,
          kind: REVERT_WORKER_KIND,
          task: "apps",
          scope: { operations: [], targets: {} },
          credential: "none",
          api_port: ctx.server.port,
        },
        { onMessage: (message) => revertChannel.onMessage(message) },
      );
      if (started.ok) {
        revertChannel.bind((payload) =>
          ctx.io.send(REVERT_WORKER_KIND, payload).then((sent) => sent.ok)
        );
      }
      return ok(undefined);
    },
  };
};
