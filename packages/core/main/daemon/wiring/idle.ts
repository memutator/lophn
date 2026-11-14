import { ok, type Result } from "../../../../base/mod.ts";
import { jobActivity } from "../../../../protocol/jobs/mod.ts";
import { runActivity } from "../../../../protocol/runs/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { workflowInstanceActivity } from "../../../../protocol/workflows/mod.ts";
import { systemTimers } from "../../../runs/mod.ts";
import { remoteEnabledSetting } from "../../../config/shell-settings.ts";
import {
  createIdleMonitor,
  type IdleActivity,
  type IdleMonitor,
} from "../idle.ts";
import type { WiringFactory } from "./context.ts";

// idle-exit가 module마다의 일을 읽는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
// module은 자기 표를 자기 activity read로만 답하고, 이 file이 셋을 합친다.
const IDLE_PRINCIPAL = "machine:idle";
const IDLE_CONTEXT: AuthenticatedContext = {
  principal: IDLE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      jobActivity.name,
      runActivity.name,
      workflowInstanceActivity.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: IDLE_PRINCIPAL,
};

const ACTIVITY_READS = [
  jobActivity,
  runActivity,
  workflowInstanceActivity,
] as const;

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

// module별 activity read, 도는 lophn agent turn, 켜 둔 remote 연결, server의 client 수를 합쳐 idle-exit를 건다. ready 뒤에 세기 시작하고,
// idle-exit는 core.ts의 shutdown barrier를 그대로 쓴다.
export const idleWiring: WiringFactory = () => {
  let monitor: IdleMonitor | undefined;
  return {
    name: "idle",
    records: () => [IDLE_CONTEXT],
    build(ctx) {
      const read = async <T>(r: {
        resource: string;
        method: string;
      }): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(route(r))!(IDLE_CONTEXT, {})) as Result<T>;
      const activity: IdleActivity = {
        async busy() {
          // 폰이 붙을 수 있게 켜 둔 동안은 끝나지 않는다. 끄는 것은 사람이 한다(`Stop lophn`).
          if (ctx.settings.get(remoteEnabledSetting) === true) return ok(true);
          // 도는 lophn agent turn은 ledger의 activity가 아니라 core 메모리의 queue가 정본이다.
          if (ctx.queue.anyRunning()) return ok(true);
          for (const each of ACTIVITY_READS) {
            const done = await read<{ busy: boolean }>(each);
            if (!done.ok) return done;
            if (done.value.busy) return ok(true);
          }
          return ok(false);
        },
        clients: () => ctx.server.activity().clients,
        arrivals: () => ctx.server.activity().arrivals,
      };
      monitor = createIdleMonitor({
        clock: ctx.clock,
        timers: systemTimers,
        activity,
        shutdown: () => void ctx.shutdown(),
        logger: ctx.telemetry.logger,
      });
      return ok({});
    },
    async afterReady() {
      monitor!.start();
    },
    closeWork() {
      monitor?.stop();
    },
  };
};
