import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
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
import {
  agentHandleKey,
  CODING_BUILTINS,
  DEFAULT_PERMISSION_MODE,
  HARNESS_RUNTIMES,
  isHarnessRuntime,
  type PermissionMode,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Output,
  Sql,
} from "../../../../protocol/server/mod.ts";
import {
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  workflowFolder,
  workflowInstanceRead,
} from "../../../../protocol/workflows/mod.ts";
import {
  defaultModeSetting,
  workflowModesSetting,
} from "../../../approvals/mod.ts";
import type { Flight } from "../../../apps/calls/intake.ts";
import { reachCheckerOf } from "../../../events/mod.ts";
import {
  JOB_HELD_TOPIC,
  JOBS_CHANGED_TOPIC,
  type JobSchedulerStore,
  type JobStarter,
} from "../../../jobs/mod.ts";
import { createJobScheduler } from "../../../jobs/scheduler.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { type RunOrigin, systemTimers } from "../../../runs/mod.ts";
import type { MachineCandidate } from "../../../../protocol/machine/requester.ts";
import {
  type LedgerConnection,
  openConnection,
  type Writer,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  parseDeclaration,
  participantsOf,
} from "../../../workflows/declaration.ts";
import {
  createFlowEventRegistry,
  type FlowEventRegistry,
} from "../../../workflows/event-subscriptions.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

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

export function createJobStarter(deps: {
  workflowService: Pick<WiringContext["workflowService"], "start">;
  runService: Pick<WiringContext["runService"], "start" | "wait">;
  instanceState: JobStarter["instanceState"];
  isClosing: () => boolean;
}): JobStarter {
  return {
    async start(job, jobRun) {
      const action = job.action;
      if (action.kind === "workflow_start") {
        // event job은 시작 입력 글을 JSON으로 준다: 고정한 글과 event(data).
        const started = await deps.workflowService.start(
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
            ...(action.inputs === undefined ? {} : { inputs: action.inputs }),
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
        remote:
          jobRun.event?.machine !== undefined || jobRun.event?.remote === true,
      };
      // tool_run은 승인한 flag(pass_event)가 있을 때만 event를 입력의 `event` 칸에 합쳐 준다.
      const input =
        action.kind === "tool_run" &&
        job.trigger?.pass_event === true &&
        jobRun.event !== null
          ? {
              input: {
                ...((action.input as Record<string, JsonValue> | undefined) ??
                  {}),
                event: jobRun.event,
              },
            }
          : action.input === undefined
            ? {}
            : { input: action.input };
      const started = await deps.runService.start(
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
              ...(action.schema === undefined ? {} : { schema: action.schema }),
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
        if (deps.isClosing()) {
          return err({
            code: "unavailable",
            message: "lophn is shutting down",
          });
        }
        const waited = await deps.runService.wait(run, WAIT_MS);
        if (!waited.ok) return waited;
        const state = waited.value.state;
        if (state !== "running") return ok({ state });
      }
    },
    // timeout 0이면 wait는 읽기 한 번이다.
    async runState(run) {
      const waited = await deps.runService.wait(run, 0);
      return waited.ok ? ok(waited.value.state) : waited;
    },
    instanceState: deps.instanceState,
  };
}

type ReadSql = Pick<Sql, "get">;

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// 사람이 연 session(터미널·앱 화면 포함)이 아니면 true다. jobs-registration의 drivenSession과 같은 기준에
// job_runs·workflow_origin을 함께 본다.
function isDrivenSession(sql: ReadSql, session: string): boolean {
  if (session.startsWith("term:")) return false;
  const row = sql.get(
    "SELECT spawned_by, called_from_kind, workflow_origin FROM sessions WHERE id = ?",
    [session],
  );
  if (row === undefined) return true;
  if (
    row["spawned_by"] !== null ||
    row["called_from_kind"] !== null ||
    row["workflow_origin"] !== null
  ) {
    return true;
  }
  if (
    sql.get("SELECT 1 AS found FROM job_runs WHERE session = ? LIMIT 1", [
      session,
    ]) !== undefined
  ) {
    return true;
  }
  return (
    sql.get(
      `SELECT 1 AS found FROM messages
        WHERE session = ? AND ((from_kind = 'human' AND unattended = 1) OR step_instance IS NOT NULL)
        LIMIT 1`,
      [session],
    ) !== undefined
  );
}

// 앱 event의 부모 invocation 사슬에서 이 event를 일으킨 workflow instance(및 상위 workflow)를 모은다.
function originInstancesOf(sql: ReadSql, parent: Flight | null): string[] {
  if (parent === null) return [];
  const seeds = new Set<string>();
  const visitedInv = new Set<string>();
  let current: string | null = parent.id;
  while (current !== null && !visitedInv.has(current)) {
    visitedInv.add(current);
    const row = sql.get(
      "SELECT caller, caller_kind, session FROM invocations WHERE id = ?",
      [current],
    );
    if (row === undefined) {
      // 기록되지 않은 읽기 invocation이 부모이면 살아 있는 flight의 상위로 한 번 올라간다.
      current = current === parent.id ? parent.parent : null;
      continue;
    }
    const caller = parseJsonObject(row["caller"]);
    if (caller === null) break;
    if (caller["kind"] === "flow" && typeof caller["instance"] === "string") {
      seeds.add(caller["instance"]);
      break;
    }
    if (caller["kind"] === "agent" && typeof row["session"] === "string") {
      const ses = sql.get("SELECT workflow_origin FROM sessions WHERE id = ?", [
        row["session"],
      ]);
      const origin = parseJsonObject(ses?.["workflow_origin"]);
      if (typeof origin?.["instance"] === "string") {
        seeds.add(origin["instance"]);
      }
      break;
    }
    if (
      (caller["kind"] === "app" || caller["kind"] === "event") &&
      typeof caller["parent_invocation"] === "string"
    ) {
      current = caller["parent_invocation"];
      continue;
    }
    break;
  }

  // sub-workflow가 낳은 앱 event가 상위 workflow의 onEvent로 돌아오지 않게 조상 instance까지 담는다.
  const all = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (all.has(id)) continue;
    all.add(id);
    const row = sql.get(
      "SELECT started_by FROM workflow_instances WHERE id = ?",
      [id],
    );
    const startedBy = parseJsonObject(row?.["started_by"]);
    if (
      startedBy?.["kind"] === "workflow" &&
      typeof startedBy["instance"] === "string" &&
      !all.has(startedBy["instance"])
    ) {
      queue.push(startedBy["instance"]);
    }
  }
  return [...all];
}

// 규칙은 jobs module의 scheduler가 갖는다. 여기는 port를 core에 잇기만 한다.
// runs·workflows 뒤다: 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다.
export const jobsWiring: WiringFactory = () => {
  let scheduler: ReturnType<typeof createJobScheduler> | undefined;
  let closing = false;
  let stopEvents: (() => void) | undefined;
  let flowEvents: FlowEventRegistry | undefined;
  let connection: LedgerConnection | undefined;
  return {
    name: "jobs",
    records: () => [JOBS_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;

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

      const starter = createJobStarter({
        workflowService: ctx.workflowService,
        runService: ctx.runService,
        async instanceState(instance) {
          const done = await read<Output<typeof workflowInstanceRead>>(
            workflowInstanceRead,
            { instance },
          );
          return done.ok ? ok(done.value.instance.state) : done;
        },
        isClosing: () => closing,
      });

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
      const registry = createFlowEventRegistry({
        reaches: reachCheckerOf(
          () => ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
        ),
        isDrivenSession: (sessionId) => isDrivenSession(sql, sessionId),
        onListenerError: ({ subscriptionId, instance, event, error }) => {
          ctx.telemetry.logger.warn({
            component: "workflows",
            event: "flow_event_listener_failed",
            fields: {
              subscription: subscriptionId,
              instance,
              event_name: event,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        },
      });
      flowEvents = registry;
      ctx.provide("flowEvents", registry);

      const offEvents = ctx.eventDelivery.addInternal({
        wantsSource: (source) =>
          source === "lophn" &&
          (triggers.some((one) => one.app === null) ||
            registry.hasSessionSubscribers()),
        deliver(event) {
          const publisher =
            event.publisher === "lophn" ? null : event.publisher;
          // lophn의 session event는 그 session과 workspace를 싣는다(보이는 범위와 비사람 session 걸러내기).
          const line = event.payload as {
            session?: string;
            workspace?: { kind: "project" | "app"; id: string } | null;
            spawned_by?: string | null;
            workflow?: { instance?: string } | null;
          } | null;
          const session =
            publisher === null && typeof line?.session === "string"
              ? {
                  id: line.session,
                  workspace: line.workspace ?? null,
                  ...(line.spawned_by != null || line.workflow != null
                    ? { driven: true as const }
                    : {}),
                }
              : null;

          // 비영속 flow onEvent 구독자 전달(job과 같은 도달·고리 규칙을 적용한다).
          if (publisher === null) {
            registry.dispatchSessionEvent({
              event: event.event,
              payload: event.payload,
              session,
            });
          } else if (registry.hasAppSubscribers(publisher, event.event)) {
            registry.dispatchAppEvent({
              app: publisher,
              source: event.source,
              event: event.event,
              payload: event.payload,
              appChain: event.chain,
              originInstances: originInstancesOf(sql, event.parent),
              ...(event.machine === undefined
                ? {}
                : { machine: event.machine }),
            });
          }

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
            ...(event.remote === true ? { remote: true as const } : {}),
            session:
              session === null
                ? null
                : { id: session.id, workspace: session.workspace },
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
        async workflowModesOf(project, workflow) {
          const remembered =
            ctx.settings.get(workflowModesSetting)?.[`${project}/${workflow}`];
          const globalDefault =
            ctx.settings.get(defaultModeSetting) ?? DEFAULT_PERMISSION_MODE;
          const folder = workflowFolder(
            ctx.root.path,
            project as Id<"prj">,
            workflow,
          );
          let declaration: string | null = null;
          try {
            declaration = await readFile(
              join(folder, WORKFLOW_DECLARATION_FILE),
              "utf8",
            );
          } catch {
            declaration = null;
          }
          if (declaration === null) {
            return remembered !== undefined ? { ...remembered } : {};
          }
          let flow = false;
          try {
            await access(join(folder, WORKFLOW_FLOW_FILE));
            flow = true;
          } catch {
            flow = false;
          }
          const parsed = parseDeclaration({
            name: workflow,
            declaration,
            flow,
            artifacts: { static: false, instance: false },
          });
          if (!parsed.ok) {
            return remembered !== undefined ? { ...remembered } : {};
          }
          const participants = participantsOf(parsed.declaration);
          const deps = workspaceDepsOf(sql);
          const resolved: Record<string, PermissionMode> = {};
          for (const [key, participant] of Object.entries(participants)) {
            if ("kind" in participant) continue;
            const handleKey = agentHandleKey(participant.agent);
            if (
              (HARNESS_RUNTIMES as readonly string[]).includes(handleKey) ||
              CODING_BUILTINS.some(
                (b) =>
                  agentHandleKey(b.harness) === handleKey ||
                  agentHandleKey(b.id) === handleKey,
              )
            ) {
              continue;
            }
            const addr = deps.names.resolveAddress({
              agent: participant.agent,
              workspace: { project },
            });
            const info = addr.ok ? deps.agents.agent(addr.value.agent) : null;
            if (info !== null && isHarnessRuntime(info.runtime)) continue;
            resolved[key] =
              remembered?.[key] ?? info?.permissionMode ?? globalDefault;
          }
          return resolved;
        },
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
      flowEvents?.clear();
      await scheduler?.stop();
      connection?.close();
      connection = undefined;
    },
  };
};
