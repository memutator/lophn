import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { JsonValue } from "../../../../protocol/base/mod.ts";
import {
  jobClaimDue,
  jobCreate,
  jobEventTriggers,
  jobFireEvent,
  jobRunEnded,
  jobRunOpen,
  jobRunStarted,
} from "../../../../protocol/jobs/mod.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import type {
  AuthenticatedContext,
  Output,
} from "../../../../protocol/server/mod.ts";
import { workflowInstanceRead } from "../../../../protocol/workflows/mod.ts";
import {
  JOB_HELD_TOPIC,
  JOBS_CHANGED_TOPIC,
  type JobSchedulerStore,
  type JobStarter,
} from "../../../jobs/mod.ts";
import { createJobScheduler } from "../../../jobs/scheduler.ts";
import { type RunOrigin, systemTimers } from "../../../runs/mod.ts";
import type { MachineCandidate } from "../../../../protocol/machine/requester.ts";
import { type Writer, withAfterCommit } from "../../../storage/ledger/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../../../protocol/lophn-agent/call-policy.ts";
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
      jobFireEvent.name,
      jobEventTriggers.name,
      workflowInstanceRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: JOBS_PRINCIPAL,
};

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

const WAIT_MS = 60_000;

// 다른 컴퓨터의 event를 때로 건 `jobs/create`의 `trigger.machine`을 저장 전에 `mch_`로 푼다. 명단은 main thread에만 있어 tx 안에서는 풀 수 없다.
// 못 풀면 `not_found`, 이름이 겹치면 후보와 `invalid_input`이고(resolveMachine), 이 컴퓨터를 가리키면 `invalid_input`이다(그 칸을 빼면 된다).
export function withTriggerMachine(
  inner: Writer,
  resolve: (ref: string) => Result<MachineCandidate> | undefined,
): Writer {
  return {
    ...inner,
    async command(ctx, envelope) {
      const trigger =
        envelope.command === jobCreate.name
          ? (envelope.input as { trigger?: { machine?: unknown } }).trigger
          : undefined;
      if (typeof trigger?.machine !== "string") {
        return inner.command(ctx, envelope);
      }
      const found = resolve(trigger.machine);
      if (found === undefined) {
        return err({
          code: "unavailable",
          message: "other computers are not available yet",
        });
      }
      if (!found.ok) return found;
      if (found.value.self) {
        return err({
          code: "invalid_input",
          message:
            "that is this computer; leave machine out to watch this computer's apps",
        });
      }
      return inner.command(ctx, {
        ...envelope,
        input: {
          ...(envelope.input as object),
          trigger: { ...trigger, machine: found.value.machine },
        },
      });
    },
  };
}

// 규칙은 jobs module의 scheduler가 갖는다. 여기는 port를 core에 잇기만 한다.
// runs·workflows 뒤다: 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다.
export const jobsWiring: WiringFactory = () => {
  let scheduler: ReturnType<typeof createJobScheduler> | undefined;
  let closing = false;
  let stopEvents: (() => void) | undefined;
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
            // event job은 시작 입력 글을 JSON으로 준다: 고정한 글과 event(data).
            const started = await ctx.workflowService.start(
              {
                workflow: `${action.project}/${action.workflow}`,
                text:
                  jobRun.event === null
                    ? action.text
                    : JSON.stringify({
                        text: action.text,
                        event: jobRun.event,
                      }),
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
          };
          // tool_run은 승인한 flag(pass_event)가 있을 때만 event를 입력의 `event` 칸에 합쳐 준다.
          const input =
            action.kind === "tool_run" &&
            job.trigger?.pass_event === true &&
            jobRun.event !== null
              ? {
                  input: {
                    ...((action.input as
                      | Record<string, JsonValue>
                      | undefined) ?? {}),
                    event: jobRun.event,
                  },
                }
              : action.input === undefined
                ? {}
                : { input: action.input };
          const started = await ctx.runService.start(
            action.kind === "agent_run"
              ? {
                  kind: "agent_resolved",
                  agent: {
                    agent: action.agent,
                    workspace: action.agent_workspace,
                  },
                  prompt: action.prompt,
                  ...input,
                  ...(jobRun.event === null ? {} : { event: jobRun.event }),
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
                session:
                  action.kind === "agent_run"
                    ? (started.value.session as Id<"ses"> | null)
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

      // event를 때로 가진 승인한 켜진 job이 있는 (앱 id 또는 null=lophn, event). event 전달이 job에 관심이 있는지 거르는 표다.
      // job이 바뀔 때마다 다시 읽는다. 저장하지 않으므로 core가 꺼진 사이의 event는 job을 열지 않는다.
      let triggers: {
        app: string | null;
        event: string;
        machine: string | null;
        workspace: { kind: "project" | "app"; id: string } | null;
      }[] = [];
      const refreshTriggers = async () => {
        const done = await read<Output<typeof jobEventTriggers>>(
          jobEventTriggers,
          {},
        );
        if (done.ok) triggers = done.value.triggers;
      };
      // 다른 컴퓨터의 event로는 이 기계의 call 정책에서 private인 workspace의 job을 열지 않는다. 감시는 컴퓨터마다라 같은 컴퓨터를 보는 다른 job이 있어도
      // 그 job이 열리지 않게 event를 낼 때 그 컴퓨터를 때로 가진 job의 workspace 가운데 private인 것을 알린다.
      const privateWorkspaces = (machine: string): string[] => {
        const policy =
          ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
        return [
          ...new Set(
            triggers.flatMap((one) =>
              one.machine === machine &&
              one.workspace !== null &&
              isPrivate(policy, one.workspace)
                ? [one.workspace.id]
                : [],
            ),
          ),
        ];
      };
      const offEvents = ctx.eventDelivery.addInternal({
        wantsSource: (source) =>
          source === "lophn" && triggers.some((one) => one.app === null),
        deliver(event) {
          const publisher =
            event.publisher === "lophn" ? null : event.publisher;
          if (
            !triggers.some(
              (one) =>
                one.app === publisher &&
                one.event === event.event &&
                one.machine === (event.machine ?? null),
            )
          ) {
            return;
          }
          // lophn의 session event는 그 session과 workspace를 싣는다(job의 보이는 범위와 자기 run 걸러내기).
          const line = event.payload as {
            session?: string;
            workspace?: { kind: "project" | "app"; id: string } | null;
          } | null;
          const session =
            publisher === null && typeof line?.session === "string"
              ? { id: line.session, workspace: line.workspace ?? null }
              : null;
          void command(jobFireEvent, {
            publisher: event.publisher,
            event: event.event,
            payload: event.payload as JsonValue,
            chain: [...event.chain],
            ...(event.machine === undefined
              ? {}
              : {
                  machine: event.machine,
                  skip_workspaces: privateWorkspaces(event.machine),
                }),
            session,
          }).then((done) => {
            if (!done.ok) {
              ctx.telemetry.logger.warn({
                component: "jobs",
                event: "fire_event_failed",
                fields: { message: done.error.message },
              });
            }
          });
        },
      });
      stopEvents = offEvents;
      void refreshTriggers();

      const built = createJobScheduler({
        clock: ctx.clock,
        timers: systemTimers,
        store,
        starter,
        logger: ctx.telemetry.logger,
      });
      scheduler = built;

      return ok({
        // job을 만들거나 켜거나 hold를 결정하면 다음 차례 시각이 바뀌므로 timer를 다시 건다.
        // 화면에 알리는 것은 job command의 `changes`(`jobs`)다.
        writer: (inner) =>
          withAfterCommit(
            withTriggerMachine(inner, (ref) =>
              ctx.peek.machineLinks?.resolve(ref),
            ),
            (actions) => {
              for (const action of actions) {
                if (action.topic === JOB_HELD_TOPIC) {
                  ctx.peek.bus?.publish(action.data as BusEvent);
                }
              }
              if (
                actions.some((action) => action.topic === JOBS_CHANGED_TOPIC)
              ) {
                void refreshTriggers();
                built.wake();
              }
            },
            ctx.telemetry.logger,
          ),
      });
    },
    async start() {
      await scheduler!.start();
      return ok(undefined);
    },
    async closeWork() {
      closing = true;
      stopEvents?.();
      await scheduler?.stop();
    },
  };
};
