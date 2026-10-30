import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  placeSessionRead,
  receivedMessageList,
  stopTurn,
  turnList,
  turnRead,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Input,
  Output,
} from "../../../../protocol/server/mod.ts";
import {
  type LineBy,
  workflowCheck,
  workflowEdit,
  workflowInstanceApply,
  workflowInstanceCreate,
  workflowInstanceRead,
  workflowList,
  workflowReport,
  workflowStart,
  workflowStop,
} from "../../../../protocol/workflows/mod.ts";
import { placeDepsOf } from "../../../lophn-agent/places/mod.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  type Writer,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import {
  createWorkflowService,
  runningInstances,
  WORKFLOW_CHANGED_TOPIC,
  type WorkflowFlows,
} from "../../../workflows/mod.ts";
import { checkWorkflow } from "../../flow-host/check.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";
import { prepareTexts } from "./router.ts";
import { createWorkflowFiles } from "./workflows-files.ts";

// workflow service가 상태를 읽고 쓰고 turn을 멈추는 core 안 machine 자격이다. step 메시지 본문 blob은 command를 부른
// 자격의 이름으로 준비돼 있어야 받는 session 기록이 읽는다(agent-call.md). 기동 때 ledger에 기록한다.
const WORKFLOWS_PRINCIPAL = "machine:workflows";
const WORKFLOWS_CONTEXT: AuthenticatedContext = {
  principal: WORKFLOWS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      workflowInstanceCreate.name,
      workflowInstanceApply.name,
      workflowInstanceRead.name,
      receivedMessageList.name,
      turnRead.name,
      turnList.name,
      stopTurn.name,
      placeSessionRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: WORKFLOWS_PRINCIPAL,
};

const SOURCE = {
  concern: "workflows",
  revision: "1",
  scope: "step-text",
};

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

// 시작 입력, report·hand_now의 글, step 메시지 본문을 redaction한다. 줄의 글에도 원문 secret이 남지 않게
// 같은 redactor를 지난다. 본문만 받는 session 기록에 들어가므로 call 본문처럼 blob으로 준비한다.
function withStepText(
  writer: Writer,
  deps: {
    relay(): BodyPrepare | undefined;
    known(): KnownSecretMatch | undefined;
  },
): Writer {
  async function prepare(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandEnvelope>> {
    const create = envelope.command === workflowInstanceCreate.name;
    if (!create && envelope.command !== workflowInstanceApply.name) {
      return ok(envelope);
    }
    const redact = createProductRedactor(deps.known());
    let unfinished = false;
    const safe = (text: string): string => {
      const done = redact(SOURCE, "text/plain", text);
      if (done === null) unfinished = true;
      return done ?? text;
    };
    const bodies: string[] = [];
    const safeHandoff = <H extends { delivery: { body: string } | null }>(
      handoff: H,
    ): H => {
      if (handoff.delivery === null) return handoff;
      const body = safe(handoff.delivery.body);
      bodies.push(body);
      return { ...handoff, delivery: { ...handoff.delivery, body } };
    };
    let input:
      | Input<typeof workflowInstanceCreate>
      | Input<typeof workflowInstanceApply>;
    if (create) {
      const raw = envelope.input as Input<typeof workflowInstanceCreate>;
      input = {
        ...raw,
        input: safe(raw.input),
        handoff: raw.handoff === null ? null : safeHandoff(raw.handoff),
      };
    } else {
      const raw = envelope.input as Input<typeof workflowInstanceApply>;
      const change = raw.change;
      input = {
        ...raw,
        change:
          change.kind === "report"
            ? { ...change, text: safe(change.text) }
            : change.kind === "edit" &&
                change.edit.op === "hand_now" &&
                change.edit.text !== undefined
              ? {
                  ...change,
                  edit: { ...change.edit, text: safe(change.edit.text) },
                }
              : // process stderr는 AI가 짠 code가 쓴 글이다. 줄에 남는 글은 여기가 마지막 관문이다.
                change.kind === "program_exited"
                ? { ...change, stderr_tail: safe(change.stderr_tail) }
                : change,
        handoff: raw.handoff === null ? null : safeHandoff(raw.handoff),
      };
    }
    if (unfinished) {
      return err({
        code: "unavailable",
        message: "workflow text redaction did not finish",
      });
    }
    if (bodies.length > 0) {
      const relay = deps.relay();
      if (relay === undefined) {
        return err({
          code: "unavailable",
          message: "blob preparation is not available",
        });
      }
      const prepared = await prepareTexts(relay, ctx, bodies);
      if (!prepared.ok) return prepared;
    }
    return ok({ ...envelope, input });
  }
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}

// 규칙은 workflows module의 service가 갖는다. 여기는 port를 core에 잇기만 한다.
// router 뒤에 돈다: 켤 때 router가 돌던 turn을 닫은 뒤여야 끊긴 step을 알아본다(runs와 같다).
export const workflowsWiring: WiringFactory = () => {
  let service: ReturnType<typeof createWorkflowService> | undefined;
  return {
    name: "workflows",
    records: () => [WORKFLOWS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 접은 writer를 쓴다. 날 writer는 본문 준비와 입력함 적용을 건너뛰어 step 메시지로 turn이 열리지 않는다.
      // ctx.writer는 build가 다 끝난 뒤 채워지므로 부를 때 읽는다.
      const command = async <T>(
        r: { name: string },
        input: unknown,
        compare: unknown = {},
      ): Promise<Result<T>> => {
        const done = await ctx.writer.command(WORKFLOWS_CONTEXT, {
          command: r.name,
          input,
          idempotency_key: ids.newId("idk"),
          compare,
          prepared: [],
        });
        return done.ok ? ok(done.value.result as T) : done;
      };
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(route(r))!(
          WORKFLOWS_CONTEXT,
          input,
        )) as Result<T>;

      // 끝까지 cursor를 따라 모은다.
      async function readAll<T extends { next_cursor?: string | null }>(
        r: { resource: string; method: string },
        input: Record<string, unknown>,
      ): Promise<Result<T[]>> {
        const pages: T[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await read<T>(r, {
            ...input,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!page.ok) return page;
          pages.push(page.value);
          const next = page.value.next_cursor;
          if (next === null || next === undefined) return ok(pages);
          cursor = next;
        }
      }

      const readTurn = (turn: Id<"trn">) =>
        read<Output<typeof turnRead>>(turnRead, { turn });

      const projects = {
        resolve(ref: string) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            placeDepsOf(lookup.sql).projects.projectByName(ref),
          );
          if (!found.ok) return Promise.resolve(found);
          return Promise.resolve(
            found.value === null
              ? err({
                  code: "not_found" as const,
                  message: "project not found",
                })
              : ok({ id: found.value.id, name: found.value.name }),
          );
        },
        nameOf(project: Id<"prj">) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            placeDepsOf(lookup.sql).projects.project(project),
          );
          if (!found.ok) return Promise.resolve(found);
          return Promise.resolve(
            found.value === null
              ? err({
                  code: "not_found" as const,
                  message: "project not found",
                })
              : ok(found.value.name),
          );
        },
      };

      const turns = {
        // 그 session에서 도는 turn을 모두 멈춘다. state_seq가 checkpoint로 움직여 compare가 어긋나면 다시 읽어 건다.
        async stopSession(session: Id<"ses">) {
          const running = await read<Output<typeof turnList>>(turnList, {
            session,
            state: "running",
          });
          if (!running.ok) return running;
          for (const { id: turn } of running.value.turns) {
            for (let attempt = 0; ; attempt++) {
              const record = await readTurn(turn as Id<"trn">);
              if (!record.ok) return record;
              if (record.value.turn.state !== "running") break;
              const stopped = await command(
                stopTurn,
                {
                  turn,
                  request_key: `workflow:${turn}`,
                  reason: "user_stopped",
                },
                { state_seq: record.value.turn.state_seq },
              );
              if (stopped.ok) break;
              if (stopped.error.code !== "conflict" || attempt >= 2) {
                return stopped;
              }
            }
          }
          return ok(undefined);
        },
        async stepTurn(session: Id<"ses">, instance: Id<"wfi">, step: string) {
          const pages = await readAll<Output<typeof receivedMessageList>>(
            receivedMessageList,
            { session },
          );
          if (!pages.ok) return pages;
          const found = pages.value
            .flatMap((p) => p.messages)
            .findLast(
              (m) => m.step?.instance === instance && m.step.step === step,
            );
          if (found === undefined) return ok(null);
          if (found.turn === null) {
            return ok({ turn: null, state: null, outcome: null });
          }
          const record = await readTurn(found.turn as Id<"trn">);
          if (!record.ok) return record;
          const { state, outcome } = record.value.turn;
          return ok({ turn: found.turn as Id<"trn">, state, outcome });
        },
      };

      const store = {
        create: (input: Input<typeof workflowInstanceCreate>) =>
          command<Output<typeof workflowInstanceCreate>>(
            workflowInstanceCreate,
            input,
          ),
        apply: (
          input: Input<typeof workflowInstanceApply>,
          compare: { state_seq: string },
        ) =>
          command<Output<typeof workflowInstanceApply>>(
            workflowInstanceApply,
            input,
            compare,
          ),
        async read(instance: Id<"wfi">) {
          const pages = await readAll<Output<typeof workflowInstanceRead>>(
            workflowInstanceRead,
            { instance },
          );
          if (!pages.ok) return pages;
          // 마지막 쪽이 가장 새 instance와 last_reports다.
          const last = pages.value[pages.value.length - 1]!;
          return ok({ ...last, lines: pages.value.flatMap((p) => p.lines) });
        },
        running() {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            runningInstances(lookup.sql),
          );
          return Promise.resolve(found.ok ? found.value : found);
        },
      };

      // flowHost는 flows wiring이 나중에 provide한다. 부를 때 읽고, 없으면 launch는 unavailable이다.
      const flows: WorkflowFlows = {
        launch: (start) => {
          const host = ctx.peek.flowHost;
          return host === undefined
            ? Promise.resolve(
                err({
                  code: "unavailable" as const,
                  message: "flow host is not running",
                }),
              )
            : host.launch(start);
        },
        stop: (instance) =>
          ctx.peek.flowHost?.stop(instance) ?? Promise.resolve(ok(undefined)),
      };

      const built = createWorkflowService({
        files: createWorkflowFiles(ctx.root.path),
        projects,
        turns,
        store,
        flows,
        ids,
        logger: ctx.telemetry.logger,
      });
      service = built;
      ctx.provide("workflowService", built);

      // 자격 판정은 하지 않는다. 줄에 적을 by만 호출한 자격에서 정한다.
      const byOf = (who: AuthenticatedContext): LineBy =>
        who.conditions.session === undefined
          ? { kind: "user" }
          : { kind: "agent", session: who.conditions.session as Id<"ses"> };

      const handler =
        (
          call: (
            input: never,
            who: AuthenticatedContext,
          ) => Promise<Result<unknown>>,
        ): MemoryHandler =>
        (who, input) =>
          call(input as never, who);

      return ok({
        writer: (inner) =>
          withStepText(
            withAfterCommit(
              inner,
              (actions) => {
                // 다른 topic은 router의 applier가 따로 본다.
                for (const action of actions) {
                  if (action.topic !== WORKFLOW_CHANGED_TOPIC) continue;
                  const changed = action.data as {
                    instance: Id<"wfi">;
                    project: Id<"prj">;
                    workflow: string;
                  };
                  ctx.bus.publish({
                    type: "WorkflowInstanceChanged",
                    subject: changed.instance,
                    at: ctx.clock.now(),
                    payload: {
                      project: changed.project,
                      workflow: changed.workflow,
                    },
                  });
                }
              },
              ctx.telemetry.logger,
            ),
            {
              relay: () => ctx.bodyPrepare,
              known: () => ctx.knownSecrets,
            },
          ),
        memory: [
          [
            route(workflowList),
            handler(async (input: Parameters<typeof built.list>[0], who) => {
              // project를 안 적으면 agent가 있는 project다.
              let defaultProject: string | null = null;
              const session = who.conditions.session;
              if (input.project === undefined && session !== undefined) {
                const found = await read<Output<typeof placeSessionRead>>(
                  placeSessionRead,
                  { session },
                );
                const place = found.ok ? found.value.session.place : null;
                if (place?.kind === "project") defaultProject = place.id;
              }
              return built.list(input, defaultProject);
            }),
          ],
          [
            route(workflowStart),
            handler((i) => built.start(i, { kind: "user" })),
          ],
          [
            route(workflowReport),
            handler((i, who) => built.report(i, byOf(who))),
          ],
          [route(workflowEdit), handler((i, who) => built.edit(i, byOf(who)))],
          [route(workflowStop), handler((i, who) => built.stop(i, byOf(who)))],
          [
            route(workflowCheck),
            checkWorkflow({
              dataRoot: ctx.root.path,
              resolveProject: projects.resolve,
            }),
          ],
        ],
      });
    },
    async start(ctx) {
      try {
        await service!.reconcile();
      } catch (e) {
        ctx.telemetry.logger.error({
          component: "workflows",
          event: "reconcile_failed",
          fields: { error: String(e) },
        });
      }
      return ok(undefined);
    },
  };
};
