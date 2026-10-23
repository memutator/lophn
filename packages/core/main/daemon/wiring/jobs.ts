import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { AgentRef, Place } from "../../../../protocol/lophn-agent/mod.ts";
import { placeOfAgentRef } from "../../../../protocol/lophn-agent/mod.ts";
import {
  jobClaimDue,
  jobRunEnded,
  jobRunOpen,
  jobRunStarted,
} from "../../../../protocol/jobs/mod.ts";
import type { RunPlace } from "../../../../protocol/runs/mod.ts";
import type {
  AuthenticatedContext,
  Output,
} from "../../../../protocol/server/mod.ts";
import { workflowInstanceRead } from "../../../../protocol/workflows/mod.ts";
import {
  JOBS_CHANGED_TOPIC,
  type JobsChangedData,
  type JobSchedulerStore,
  type JobStarter,
} from "../../../jobs/mod.ts";
import { createJobScheduler } from "../../../jobs/scheduler.ts";
import { type RunOrigin, systemTimers } from "../../../runs/mod.ts";
import { withAfterCommit } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// scheduler가 차례를 가져가고 줄을 닫고 workflow instance 상태를 읽는 core 안 machine 자격이다.
// 기동 때 ledger에 기록한다.
const JOBS_PRINCIPAL = "machine:jobs";
const JOBS_CONTEXT: AuthenticatedContext = {
  principal: JOBS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      jobClaimDue.name,
      jobRunOpen.name,
      jobRunStarted.name,
      jobRunEnded.name,
      workflowInstanceRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: JOBS_PRINCIPAL,
};

// wiring file끼리 import하지 않으므로 runs.ts의 같은 이름 함수를 한 벌 다시 둔다.
const runPlaceOf = (place: Place | null): RunPlace | null =>
  place === null
    ? null
    : place.kind === "project"
    ? { project: place.id }
    : { app: place.id };

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

const WAIT_MS = 60_000;

// 규칙은 jobs module의 scheduler가 갖는다. 여기는 port를 core에 잇기만 한다.
// runs·workflows 뒤다: 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다.
export const jobsWiring: WiringFactory = () => {
  let scheduler: ReturnType<typeof createJobScheduler> | undefined;
  let closing = false;
  return {
    name: "jobs",
    records: () => [JOBS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 접은 writer를 쓴다. ctx.writer는 build가 다 끝난 뒤 채워지므로 부를 때 읽는다.
      const command = async <T>(
        r: { name: string },
        input: unknown,
      ): Promise<Result<T>> => {
        const done = await ctx.writer.command(JOBS_CONTEXT, {
          command: r.name,
          input,
          idempotency_key: ids.newId("idk"),
          compare: {},
          prepared: [],
        });
        return done.ok ? ok(done.value.result as T) : done;
      };
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(route(r))!(
          JOBS_CONTEXT,
          input,
        )) as Result<T>;

      const store: JobSchedulerStore = {
        claimDue: (startup) =>
          command<Output<typeof jobClaimDue>>(jobClaimDue, { startup }),
        async open() {
          const done = await read<Output<typeof jobRunOpen>>(jobRunOpen, {});
          return done.ok ? ok(done.value.open) : done;
        },
        async started(jobRun, found) {
          const done = await command(jobRunStarted, {
            job_run: jobRun,
            ...found,
          });
          return done.ok ? ok(undefined) : done;
        },
        async ended(jobRun, state, reason) {
          const done = await command(jobRunEnded, {
            job_run: jobRun,
            state,
            ...(reason === undefined ? {} : { reason }),
          });
          return done.ok ? ok(undefined) : done;
        },
      };

      const starter: JobStarter = {
        async start(job, jobRun) {
          const action = job.action;
          if (action.kind === "workflow_start") {
            const started = await ctx.workflowService.start(
              {
                workflow: `${action.project}/${action.workflow}`,
                text: action.text,
                ...(action.step === undefined ? {} : { step: action.step }),
              },
              { kind: "job", job: job.id },
            );
            return started.ok
              ? ok({
                run: null,
                instance: started.value.instance.id as Id<"wfi">,
                session: null,
              })
              : started;
          }
          const origin: RunOrigin = {
            job: job.id as Id<"job">,
            job_run: jobRun.id as Id<"jbr">,
            creator: job.creator as AgentRef,
            creator_place: placeOfAgentRef(job.creator) ?? null,
          };
          const input = action.input === undefined
            ? {}
            : { input: action.input };
          const started = await ctx.runService.start(
            action.kind === "agent_run"
              ? {
                kind: "agent_resolved",
                agent: action.agent,
                place: runPlaceOf(action.agent_place),
                prompt: action.prompt,
                ...input,
                ...(action.schema === undefined
                  ? {}
                  : { schema: action.schema }),
              }
              : {
                kind: "tool",
                app: action.app,
                tool: action.tool,
                ...input,
              },
            origin,
          );
          return started.ok
            ? ok({
              run: started.value.id as Id<"run">,
              instance: null,
              session: action.kind === "agent_run"
                ? started.value.session as Id<"ses"> | null
                : null,
            })
            : started;
        },
        // wait는 최대 60초만 기다린다(run.md). runService.close()가 걸린 wait를 풀어 주므로 closing이면 멈춘다.
        async waitRun(run) {
          for (;;) {
            if (closing) {
              return err({
                code: "unavailable",
                message: "lophn is shutting down",
              });
            }
            const waited = await ctx.runService.wait(run, WAIT_MS);
            if (!waited.ok) return waited;
            const state = waited.value.state;
            if (state !== "running") return ok({ state });
          }
        },
        // timeout 0이면 wait는 읽기 한 번이다.
        async runState(run) {
          const waited = await ctx.runService.wait(run, 0);
          return waited.ok ? ok(waited.value.state) : waited;
        },
        async instanceState(instance) {
          const done = await read<Output<typeof workflowInstanceRead>>(
            workflowInstanceRead,
            { instance },
          );
          return done.ok ? ok(done.value.instance.state) : done;
        },
      };

      const built = createJobScheduler({
        clock: ctx.clock,
        timers: systemTimers,
        store,
        starter,
      });
      scheduler = built;

      return ok({
        // job을 만들거나 켜거나 hold를 결정하면 다음 차례 시각이 바뀌므로 timer를 다시 건다.
        writer: (inner) =>
          withAfterCommit(inner, (actions) => {
            let changed = false;
            for (const action of actions) {
              if (action.topic !== JOBS_CHANGED_TOPIC) continue;
              const data = action.data as JobsChangedData;
              changed = true;
              ctx.bus.publish({
                type: "JobChanged",
                subject: data.job,
                at: ctx.clock.now(),
                payload: { job_run: data.job_run },
              });
            }
            if (changed) built.wake();
          }),
      });
    },
    async start() {
      await scheduler!.start();
      return ok(undefined);
    },
    async closeWork() {
      closing = true;
      await scheduler?.stop();
    },
  };
};
