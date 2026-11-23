import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { type Id, parseActor } from "../../../../protocol/base/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  agentCards,
  messageBody,
  receivedMessageList,
  stopTurn,
  turnList,
  turnRead,
  workspaceSessionRead,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Input,
  Output,
} from "../../../../protocol/server/mod.ts";
import {
  type HandoffPlan,
  type LineBy,
  type WorkflowSoftOutput,
  workflowCheck,
  workflowCheckpointUpsert,
  workflowDelete,
  workflowEdit,
  workflowFolder,
  workflowInstanceApply,
  workflowInstanceCreate,
  workflowInstanceRead,
  workflowList,
  workflowRename,
  workflowReport,
  workflowResume,
  workflowRetry,
  workflowStart,
  workflowStop,
} from "../../../../protocol/workflows/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  type BodyPrepare,
  prepareBytes,
} from "../../../lophn-agent/session/message-body.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import {
  AGENT_CALL_SETTLED_TOPIC,
  type AgentCallSettledNotice,
  callsStepReport,
  countOpenOutgoingCalls,
  remoteWorkspaceOf,
} from "../../../router/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  openConnection,
  type Writer,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import {
  type AgentCallsSettledEvent,
  type AgentPrimitivePorts,
  type AgentTurnEndedEvent,
  type AgentTurnStartedEvent,
  captureWorkflowSnapshot,
  createWorkflowService,
  loadCheckpoints,
  loadChildInstances,
  mapTurnOutcomeToReason,
  redactCheckpointPayload,
  remoteHandOf,
  runningInstances,
  type WorkflowFlows,
  type WorkflowOutcome,
  type WorkflowRemote,
  type WorkflowSnapshots,
  workflowsNoHarnessKindSteps,
} from "../../../workflows/mod.ts";
import { redactJsonValues } from "../../../workflows/plan.ts";
import type {
  WorkflowAgents,
  WorkflowLifecycle,
} from "../../../workflows/ports.ts";
import { hasTable } from "../../../workflows/store.ts";
import { checkWorkflow } from "../../flow-host/check.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";
import { prepareTexts } from "./router.ts";
import { turnAnswer } from "./turn-answer.ts";
import {
  createWorkflowFiles,
  updateWorkspaceLayoutForWorkflowDelete,
  updateWorkspaceLayoutForWorkflowRename,
} from "./workflows-files.ts";

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
      workflowCheckpointUpsert.name,
      workflowInstanceRead.name,
      agentCards.name,
      callsStepReport.name,
      receivedMessageList.name,
      messageBody.name,
      turnRead.name,
      turnList.name,
      stopTurn.name,
      workspaceSessionRead.name,
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

// 시작 입력(text·inputs), report·hand_now·retried·escalated의 글, step_stalled 오류 글, report의 refs/data,
// checkpoint의 output/error, step 메시지 본문을 재귀 fail-closed redaction한다.
// 줄의 글과 inputs_json·checkpoint에도 원문 secret이 남지 않게 같은 redactor를 지난다.
export function withStepText(
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
    const applyCmd = envelope.command === workflowInstanceApply.name;
    const upsertCp = envelope.command === workflowCheckpointUpsert.name;
    if (!create && !applyCmd && !upsertCp) {
      return ok(envelope);
    }
    const redact = createProductRedactor(deps.known());
    let unfinished = false;
    const safe = (text: string): string => {
      const done = redact(SOURCE, "text/plain", text);
      if (done === null) unfinished = true;
      return done ?? text;
    };
    const safeJson = (value: unknown): unknown => {
      const done = redactJsonValues(value, (text) =>
        redact(SOURCE, "text/plain", text),
      );
      if (!done.ok) {
        unfinished = true;
        return value;
      }
      return done.value;
    };

    if (upsertCp) {
      const raw = envelope.input as Input<typeof workflowCheckpointUpsert>;
      const redacted = redactCheckpointPayload(
        {
          ...(raw.output !== undefined ? { output: raw.output } : {}),
          ...(raw.error !== undefined ? { error: raw.error } : {}),
        },
        (text) => redact(SOURCE, "text/plain", text),
      );
      if (!redacted.ok) return redacted;
      return ok({
        ...envelope,
        input: {
          ...raw,
          ...(redacted.value.output !== undefined
            ? { output: redacted.value.output }
            : {}),
          ...(redacted.value.error !== undefined
            ? { error: redacted.value.error }
            : {}),
        },
      });
    }

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
        ...(raw.inputs !== undefined
          ? { inputs: safeJson(raw.inputs) as Record<string, unknown> }
          : {}),
        handoff: raw.handoff === null ? null : safeHandoff(raw.handoff),
      };
    } else {
      const raw = envelope.input as Input<typeof workflowInstanceApply>;
      const change = raw.change;
      let nextChange: Input<typeof workflowInstanceApply>["change"] = change;
      switch (change.kind) {
        case "report":
          nextChange = {
            ...change,
            text: safe(change.text),
            ...(change.refs !== undefined
              ? { refs: change.refs.map(safe) }
              : {}),
            ...(change.data !== undefined
              ? { data: safeJson(change.data) as typeof change.data }
              : {}),
          };
          break;
        case "edit":
          if (change.edit.op === "hand_now" && change.edit.text !== undefined) {
            nextChange = {
              ...change,
              edit: { ...change.edit, text: safe(change.edit.text) },
            };
          }
          break;
        case "program_exited":
          // process stderr는 AI가 짠 code가 쓴 글이다. 줄에 남는 글은 여기가 마지막 관문이다.
          nextChange = { ...change, stderr_tail: safe(change.stderr_tail) };
          break;
        case "step_stalled":
          if (change.message !== undefined) {
            nextChange = { ...change, message: safe(change.message) };
          }
          break;
        case "retried":
          if (change.body !== undefined) {
            const body = safe(change.body);
            bodies.push(body);
            nextChange = { ...change, body };
          }
          break;
        case "escalated":
          nextChange = { ...change, text: safe(change.text) };
          break;
      }
      input = {
        ...raw,
        change: nextChange,
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

function formatAgentStepBody(input: {
  prompt: string;
  input?: unknown;
  schema?: Record<string, unknown>;
}): string {
  const sections = [input.prompt];
  if (input.input !== undefined) {
    sections.push(`Input:\n${JSON.stringify(input.input, null, 2)}`);
  }
  if (input.schema !== undefined) {
    sections.push(`Output schema:\n${JSON.stringify(input.schema, null, 2)}`);
  }
  return sections.join("\n\n");
}

// 규칙은 workflows module의 service가 갖는다. 여기는 port를 core에 잇기만 한다.
// router 뒤에 돈다: 켤 때 router가 돌던 turn을 닫은 뒤여야 끊긴 step을 알아본다(runs와 같다).
export const workflowsWiring: WiringFactory = () => {
  let service: ReturnType<typeof createWorkflowService> | undefined;
  let unsubscribe: (() => void) | undefined;
  const turnEndedListeners = new Set<(event: AgentTurnEndedEvent) => void>();
  const turnStartedListeners = new Set<
    (event: AgentTurnStartedEvent) => void
  >();
  const callsSettledListeners = new Set<
    (event: AgentCallsSettledEvent) => void
  >();
  let readHelper:
    | (<T>(
        r: { resource: string; method: string },
        input: unknown,
      ) => Promise<Result<T>>)
    | undefined;

  return {
    name: "workflows",
    schemaStepsAfterTeams: workflowsNoHarnessKindSteps,
    records: () => [WORKFLOWS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 접은 writer를 쓴다. 날 writer는 본문 준비와 queue 적용을 건너뛰어 step 메시지로 turn이 열리지 않는다.
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
      readHelper = read;

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
            workspaceDepsOf(lookup.sql).projects.projectByName(ref),
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
            workspaceDepsOf(lookup.sql).projects.project(project),
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
        openOutgoingCalls(session: Id<"ses">) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            countOpenOutgoingCalls(lookup, session),
          );
          return Promise.resolve(found);
        },
        isTurnRunning(session: Id<"ses">) {
          const found = ledgerSnapshot(
            ctx.ledgerPath,
            (lookup) =>
              lookup.sql.get(
                "SELECT 1 AS found FROM turns WHERE session = ? AND state = 'running' LIMIT 1",
                [session],
              ) !== undefined,
          );
          return Promise.resolve(found);
        },
        lastTurn(session: Id<"ses">) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
            const row = lookup.sql.get(
              `SELECT id, state, outcome_kind, outcome_reason
               FROM turns WHERE session = ? ORDER BY rowid DESC LIMIT 1`,
              [session],
            );
            if (row === undefined) return null;
            const state = String(row["state"]) as "running" | "finished";
            const kind = row["outcome_kind"];
            const reason = row["outcome_reason"];
            const outcome =
              typeof kind === "string" && typeof reason === "string"
                ? ({ kind, reason } as Output<
                    typeof turnRead
                  >["turn"]["outcome"])
                : null;
            return {
              turn: String(row["id"]) as Id<"trn">,
              state,
              outcome,
            };
          });
          return Promise.resolve(found);
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
        upsertCheckpoint: (input: Input<typeof workflowCheckpointUpsert>) =>
          command<Output<typeof workflowCheckpointUpsert>>(
            workflowCheckpointUpsert,
            input,
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
        checkpoints(instance: Id<"wfi">) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            loadCheckpoints(lookup.sql, instance),
          );
          return Promise.resolve(found.ok ? found.value : found);
        },
        children(parent: Id<"wfi">) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            loadChildInstances(lookup.sql, parent),
          );
          return Promise.resolve(found.ok ? found.value : found);
        },
      };

      const snapshots: WorkflowSnapshots = {
        async capture(project, workflow) {
          const relay = ctx.peek.bodyPrepare;
          if (relay === undefined) {
            return err({
              code: "unavailable",
              message: "blob preparation is not available",
            });
          }
          return await captureWorkflowSnapshot(
            workflowFolder(ctx.root.path, project, workflow),
            {
              async put(bytes, purpose) {
                const prepared = await prepareBytes(
                  relay,
                  WORKFLOWS_CONTEXT,
                  purpose,
                  bytes,
                  "workflow snapshot",
                );
                if (!prepared.ok) return prepared;
                return ok({
                  hash: prepared.value,
                  sizeBytes: bytes.byteLength,
                });
              },
            },
          );
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

      // 다른 컴퓨터의 참가자. 명단은 machine links(remote wiring이 나중에 놓는다)에서 부를 때 읽는다.
      const remote: WorkflowRemote = {
        computer(ref) {
          const links = ctx.peek.machineLinks;
          if (links === undefined) {
            return err({
              code: "unavailable",
              message: "this computer's roster is not ready",
            });
          }
          const found = links.resolve(ref);
          if (!found.ok) return found;
          if (found.value.self || found.value.machine === ctx.machine.id) {
            return err({
              code: "invalid_input",
              message: `${ref} is this computer; leave on out to run the step here`,
            });
          }
          return ok({
            machine: found.value.machine as Id<"mch">,
            computer: found.value.name,
          });
        },
        workspace(name, project) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            remoteWorkspaceOf(lookup.sql, name ?? { project }, "", {
              kind: "project",
              id: project,
            }),
          );
          return found.ok ? found.value : found;
        },
        isPrivate: (project) =>
          isPrivate(
            ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
            { kind: "project", id: project },
          ),
        async receivedStep(session, instance, step) {
          // 다른 컴퓨터의 mail이 연 session만 그런 step을 받는다. 이 컴퓨터의 session은 기록을 읽지 않는다.
          const opened = ledgerSnapshot(
            ctx.ledgerPath,
            (lookup) => loadSession(lookup, session)?.opened_by_machine ?? null,
          );
          if (!opened.ok) return opened;
          if (opened.value === null) return ok(null);
          const pages = await readAll<Output<typeof receivedMessageList>>(
            receivedMessageList,
            { session },
          );
          if (!pages.ok) return pages;
          const found = pages.value
            .flatMap((p) => p.messages)
            .findLast(
              (m) =>
                m.step?.instance === instance &&
                m.step.step === step &&
                m.call !== null,
            );
          return ok(found?.call ?? null);
        },
        async report(input) {
          const text = createProductRedactor(ctx.peek.knownSecrets)(
            SOURCE,
            "text/plain",
            input.text,
          );
          if (text === null) {
            return err({
              code: "unavailable",
              message: "workflow text redaction did not finish",
            });
          }
          const sent = await command(callsStepReport, {
            ...input,
            text,
            unattended: true,
          });
          return sent.ok ? ok(undefined) : sent;
        },
        handOf(call) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            remoteHandOf(lookup.sql, call),
          );
          if (!found.ok) return found;
          const hand = found.value;
          return ok(
            hand === null
              ? null
              : { instance: hand.instance as Id<"wfi">, step: hand.step },
          );
        },
      };

      // project workspace에서 호출 가능한 agent 목록은 reader의 agents/cards를 재사용한다(a2a-lists·app-calls와 같은 출처).
      const agents: WorkflowAgents = {
        async listCallable(project) {
          const listed = await ctx.runtime.readers.read(
            agentCards,
            WORKFLOWS_CONTEXT,
            { workspace: { kind: "project", id: project } },
          );
          if (!listed.ok) return listed;
          const { cards } = listed.value as Output<typeof agentCards>;
          return ok(
            cards.map((card) => ({
              name: card.handle,
              label: card.name,
              kind: card.runtime,
            })),
          );
        },
      };

      const lifecycle: WorkflowLifecycle = {
        renameLedger(project, from, to) {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return Promise.resolve(opened);
          try {
            opened.value.exec("BEGIN IMMEDIATE");
            const { sql } = opened.value;
            sql.run(
              "UPDATE workflow_instances SET workflow = ? WHERE project = ? AND workflow = ?",
              [to, project, from],
            );
            if (hasTable(sql, "flow_sdk_reviews")) {
              sql.run(
                "UPDATE flow_sdk_reviews SET workflow = ? WHERE project = ? AND workflow = ?",
                [to, project, from],
              );
            }
            let updatedJobs = 0;
            if (hasTable(sql, "jobs")) {
              const res = sql.run(
                `UPDATE jobs
                 SET action = json_set(action, '$.workflow', ?1),
                     updated_at = ?2
                 WHERE json_extract(action, '$.kind') = 'workflow_start'
                   AND json_extract(action, '$.project') = ?3
                   AND json_extract(action, '$.workflow') = ?4`,
                [to, ctx.clock.now(), project, from],
              );
              updatedJobs = Number(res.changes);
            }
            if (hasTable(sql, "sessions")) {
              sql.run(
                `UPDATE sessions
                 SET workflow_origin = json_set(workflow_origin, '$.workflow', ?1)
                 WHERE workflow_origin IS NOT NULL
                   AND json_extract(workflow_origin, '$.project') = ?2
                   AND json_extract(workflow_origin, '$.workflow') = ?3`,
                [to, project, from],
              );
            }
            opened.value.exec("COMMIT");
            return Promise.resolve(ok({ updated_jobs: updatedJobs }));
          } catch (thrown) {
            try {
              if (opened.value.inTransaction()) opened.value.exec("ROLLBACK");
            } catch {
              // ignore rollback error
            }
            return Promise.resolve(
              err({
                code: "unavailable" as const,
                message: `could not update ledger for workflow rename: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              }),
            );
          } finally {
            opened.value.close();
          }
        },
        deleteLedger(project, name) {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return Promise.resolve(opened);
          try {
            opened.value.exec("BEGIN IMMEDIATE");
            const { sql } = opened.value;
            let erasedJobs = 0;
            if (hasTable(sql, "jobs")) {
              const rows = sql.all(
                `SELECT id FROM jobs
                 WHERE json_extract(action, '$.kind') = 'workflow_start'
                   AND json_extract(action, '$.project') = ?1
                   AND json_extract(action, '$.workflow') = ?2`,
                [project, name],
              );
              const hasRuns = hasTable(sql, "job_runs");
              for (const row of rows) {
                const jobId = String(row["id"]);
                if (hasRuns) {
                  sql.run("DELETE FROM job_runs WHERE job = ?", [jobId]);
                }
                sql.run("DELETE FROM jobs WHERE id = ?", [jobId]);
                erasedJobs += 1;
              }
            }
            if (hasTable(sql, "flow_sdk_reviews")) {
              sql.run(
                "DELETE FROM flow_sdk_reviews WHERE project = ? AND workflow = ?",
                [project, name],
              );
            }
            opened.value.exec("COMMIT");
            return Promise.resolve(ok({ erased_jobs: erasedJobs }));
          } catch (thrown) {
            try {
              if (opened.value.inTransaction()) opened.value.exec("ROLLBACK");
            } catch {
              // ignore rollback error
            }
            return Promise.resolve(
              err({
                code: "unavailable" as const,
                message: `could not update ledger for workflow delete: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              }),
            );
          } finally {
            opened.value.close();
          }
        },
        updateLayoutOnRename: (project, from, to) =>
          updateWorkspaceLayoutForWorkflowRename(
            ctx.root.path,
            project,
            from,
            to,
          ),
        updateLayoutOnDelete: (project, name) =>
          updateWorkspaceLayoutForWorkflowDelete(ctx.root.path, project, name),
        publishRenamed(project, from, to, updatedJobs) {
          const at = ctx.clock.now();
          ctx.bus.publish({
            type: "WorkflowRenamed",
            subject: project,
            at,
            payload: { from, to },
          } as never);
          publishStateChanged(ctx.bus, at, [
            { name: "projects", id: project },
            { name: "workflow_instances", id: null },
            ...(updatedJobs > 0 ? [{ name: "jobs" as const, id: null }] : []),
          ]);
        },
        publishRemoved(project, name, erasedJobs) {
          const at = ctx.clock.now();
          ctx.bus.publish({
            type: "WorkflowRemoved",
            subject: project,
            at,
            payload: { name },
          } as never);
          publishStateChanged(ctx.bus, at, [
            { name: "projects", id: project },
            { name: "workflow_instances", id: null },
            ...(erasedJobs > 0 ? [{ name: "jobs" as const, id: null }] : []),
          ]);
        },
      };

      const built = createWorkflowService({
        files: createWorkflowFiles(ctx.root.path),
        projects,
        agents,
        turns,
        store,
        flows,
        remote,
        snapshots,
        lifecycle,
        clock: ctx.clock,
        ids,
        logger: ctx.telemetry.logger,
      });

      const agentPorts: AgentPrimitivePorts = {
        async handOff(input) {
          const plan: HandoffPlan = {
            step: input.origin.step,
            participant: input.agent.agent,
            human_turn: input.human,
            cause: "start",
            session: input.session === undefined ? "new" : "same",
            delivery: {
              to:
                input.session === undefined
                  ? input.agent
                  : {
                      ...input.agent,
                      session: input.session,
                      fallback: "new",
                    },
              body: formatAgentStepBody(input),
            },
            unresolved: null,
          };
          const applied = await built.handOffStep({
            instance: input.origin.instance as Id<"wfi">,
            plan,
          });
          if (!applied.ok) {
            return {
              ok: false,
              reason: applied.error.code,
              message: applied.error.message,
            };
          }
          const handed = applied.value.handed;
          if (handed === null || handed.outcome !== "handed") {
            return {
              ok: false,
              reason: "unavailable",
              message:
                handed?.outcome === "not_handed"
                  ? handed.message
                  : "step was not handed off",
            };
          }
          if (handed.receiver === null) {
            return {
              ok: false,
              reason: "internal",
              message: "local handoff returned no receiver session",
            };
          }
          return { ok: true, session: handed.receiver as Id<"ses"> };
        },
        async handOffRemote(
          input,
        ): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
          const originProject = input.origin.project as Id<"prj">;
          const originInstance = input.origin.instance as Id<"wfi">;
          if (remote.isPrivate(originProject)) {
            return {
              ok: false,
              reason: "forbidden",
              message:
                "a private workspace does not hand steps to another computer",
            };
          }
          const computer = remote.computer(input.on);
          if (!computer.ok) {
            return {
              ok: false,
              reason: computer.error.code,
              message: computer.error.message,
            };
          }
          const workspace = remote.workspace(
            input.agent.workspace,
            originProject,
          );
          if (!workspace.ok) {
            return {
              ok: false,
              reason: workspace.error.code,
              message: workspace.error.message,
            };
          }
          const reuse =
            input.session === "same"
              ? (input.sameSession ?? undefined)
              : input.session !== undefined && input.session !== "new"
                ? input.session
                : undefined;
          const plan: HandoffPlan = {
            step: input.origin.step,
            participant: input.agent.agent,
            human_turn: false,
            cause: "start",
            session: input.session === "same" ? "same" : "new",
            delivery: {
              remote: {
                machine: computer.value.machine,
                computer: computer.value.computer,
                address:
                  reuse === undefined
                    ? { agent: input.agent.agent, workspace: workspace.value }
                    : {
                        agent: input.agent.agent,
                        workspace: workspace.value,
                        session: reuse,
                        fallback: "new",
                      },
              },
              body: formatAgentStepBody(input),
            },
            unresolved: null,
          };
          const applied = await built.handOffStep({
            instance: input.origin.instance as Id<"wfi">,
            plan,
          });
          if (!applied.ok) {
            return {
              ok: false,
              reason: applied.error.code,
              message: applied.error.message,
            };
          }
          if (applied.value.handed?.outcome !== "handed") {
            return {
              ok: false,
              reason: "unavailable",
              message:
                applied.value.handed?.outcome === "not_handed"
                  ? applied.value.handed.message
                  : "remote step handoff failed",
            };
          }
          const handedLineSeq = Number(applied.value.line);
          return await new Promise<WorkflowOutcome<WorkflowSoftOutput>>(
            (resolve) => {
              let settled = false;
              const finish = (outcome: WorkflowOutcome<WorkflowSoftOutput>) => {
                if (settled) return;
                settled = true;
                input.signal?.removeEventListener("abort", onAbort);
                offReport();
                offUpdate();
                resolve(outcome);
              };
              const checkState = async () => {
                const current = await store.read(originInstance);
                if (!current.ok || settled) return;
                for (const line of current.value.lines) {
                  if (Number(line.seq) <= handedLineSeq) continue;
                  if (
                    line.kind === "report" &&
                    line.step === input.origin.step &&
                    line.by.kind === "remote"
                  ) {
                    finish({
                      ok: true,
                      result: {
                        summary: line.text,
                        ...(line.refs !== undefined ? { refs: line.refs } : {}),
                        ...(line.data !== undefined ? { data: line.data } : {}),
                      },
                    });
                    return;
                  }
                  if (
                    line.kind === "not_handed" &&
                    line.step === input.origin.step
                  ) {
                    finish({
                      ok: false,
                      reason: "unavailable",
                      message: line.message,
                    });
                    return;
                  }
                }
                if (current.value.instance.state === "stopped") {
                  finish({
                    ok: false,
                    reason: "cancelled",
                    message: "workflow instance was stopped",
                  });
                }
              };
              const onAbort = () => {
                finish({
                  ok: false,
                  reason: "cancelled",
                  message: "remote agent call cancelled",
                });
              };
              if (input.signal !== undefined) {
                if (input.signal.aborted) {
                  onAbort();
                  return;
                }
                input.signal.addEventListener("abort", onAbort, { once: true });
              }
              const offReport = built.subscribeReports((event) => {
                if (
                  event.instance === input.origin.instance &&
                  event.step === input.origin.step
                ) {
                  finish({
                    ok: true,
                    result: {
                      summary: event.summary,
                      ...(event.refs !== undefined ? { refs: event.refs } : {}),
                      ...(event.data !== undefined ? { data: event.data } : {}),
                    },
                  });
                }
              });
              const offUpdate = ctx.bus.subscribe(
                [{ types: ["StateChanged"] }],
                {
                  send(event) {
                    if (event.type !== "StateChanged") return;
                    if (
                      event.payload.changes.some(
                        (c) =>
                          c.name === "workflow_instances" &&
                          c.id === originInstance,
                      )
                    ) {
                      void checkState();
                    }
                  },
                  close() {},
                },
              );
              void checkState();
            },
          );
        },
        async openOutgoingCalls(session) {
          const res = await turns.openOutgoingCalls(session);
          if (!res.ok) throw new Error(res.error.message);
          return res.value;
        },
        subscribeTurnEnded(fn) {
          turnEndedListeners.add(fn);
          return () => {
            turnEndedListeners.delete(fn);
          };
        },
        subscribeTurnStarted(fn) {
          turnStartedListeners.add(fn);
          return () => {
            turnStartedListeners.delete(fn);
          };
        },
        subscribeCallsSettled(fn) {
          callsSettledListeners.add(fn);
          return () => {
            callsSettledListeners.delete(fn);
          };
        },
        subscribeReport(fn) {
          return built.subscribeReports(fn);
        },
        async isTurnRunning(session) {
          const res = await turns.isTurnRunning(session);
          return res.ok ? res.value : false;
        },
        async stopSession(session) {
          await turns.stopSession(session);
        },
        async onStalled(info) {
          await built.recordStall({
            instance: info.origin.instance as Id<"wfi">,
            step: info.origin.step,
            session: info.session,
            ...(info.reason !== undefined ? { reason: info.reason } : {}),
            ...(info.message !== undefined ? { message: info.message } : {}),
          });
        },
        clock: ctx.clock,
      };
      built.setAgentPorts(agentPorts);

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

      const resolveScopedProject = async (
        who: AuthenticatedContext,
        requested: string | undefined,
      ): Promise<Result<string | null>> => {
        if (parseActor(who.actor)?.kind !== "agent") {
          return ok(requested ?? null);
        }
        const session = who.conditions.session;
        if (session !== undefined) {
          const found = await read<Output<typeof workspaceSessionRead>>(
            workspaceSessionRead,
            { session },
          );
          const workspace = found.ok ? found.value.session.workspace : null;
          if (workspace?.kind === "app") {
            return err({
              code: "forbidden",
              message: "an app agent cannot modify project workflows",
            });
          }
          if (workspace?.kind === "project") {
            if (requested !== undefined && requested !== workspace.id) {
              return err({
                code: "forbidden",
                message:
                  "an agent can only modify workflows in its own project",
              });
            }
            return ok(workspace.id);
          }
          if (found.ok) return ok(requested ?? null);
        }
        if (who.conditions.app !== undefined) {
          return err({
            code: "forbidden",
            message: "an app agent cannot modify project workflows",
          });
        }
        if (who.conditions.project !== undefined) {
          if (requested !== undefined && requested !== who.conditions.project) {
            return err({
              code: "forbidden",
              message: "an agent can only modify workflows in its own project",
            });
          }
          return ok(who.conditions.project);
        }
        return ok(requested ?? null);
      };

      return ok({
        writer: (inner) =>
          withAfterCommit(
            withStepText(inner, {
              relay: () => ctx.bodyPrepare,
              known: () => ctx.knownSecrets,
            }),
            (actions) => {
              if (callsSettledListeners.size === 0) return;
              for (const action of actions) {
                if (action.topic !== AGENT_CALL_SETTLED_TOPIC) continue;
                const notice = action.data as AgentCallSettledNotice;
                const event: AgentCallsSettledEvent = {
                  session: notice.session,
                  call: notice.call,
                  state: notice.state,
                  failReason: notice.fail_reason,
                };
                for (const fn of [...callsSettledListeners]) {
                  try {
                    fn(event);
                  } catch {
                    // ignore listener error
                  }
                }
              }
            },
            ctx.telemetry.logger,
          ),
        memory: [
          [
            route(workflowList),
            handler(async (input: Parameters<typeof built.list>[0], who) => {
              // project를 안 적으면 agent가 있는 project다.
              let defaultProject: string | null = null;
              const session = who.conditions.session;
              if (input.project === undefined && session !== undefined) {
                const found = await read<Output<typeof workspaceSessionRead>>(
                  workspaceSessionRead,
                  { session },
                );
                const workspace = found.ok
                  ? found.value.session.workspace
                  : null;
                if (workspace?.kind === "project")
                  defaultProject = workspace.id;
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
          [route(workflowRetry), handler((i) => built.retry(i))],
          [route(workflowResume), handler((i) => built.resume(i))],
          [route(workflowStop), handler((i, who) => built.stop(i, byOf(who)))],
          [
            route(workflowCheck),
            checkWorkflow({
              dataRoot: ctx.root.path,
              resolveProject: projects.resolve,
            }),
          ],
          [
            route(workflowRename),
            handler(async (i: Parameters<typeof built.rename>[0], who) => {
              const scoped = await resolveScopedProject(who, i.project);
              if (!scoped.ok) return scoped;
              return built.rename(i, scoped.value);
            }),
          ],
          [
            route(workflowDelete),
            handler(async (i: Parameters<typeof built.remove>[0], who) => {
              const scoped = await resolveScopedProject(who, i.project);
              if (!scoped.ok) return scoped;
              return built.remove(i, scoped.value);
            }),
          ],
        ],
      });
    },
    async start(ctx) {
      // TurnStarted·TurnEnded·StateChanged를 reconcile 전에 구독해 replay 중 도착하는 event를 놓치지 않는다.
      unsubscribe = ctx.bus.subscribe(
        [{ types: ["TurnStarted", "TurnEnded", "StateChanged"] }],
        {
          send(event) {
            if (event.type === "StateChanged") {
              for (const change of event.payload.changes) {
                if (
                  change.name === "workflow_instances" &&
                  change.id !== null
                ) {
                  service!.notifyInstanceUpdated(change.id);
                }
              }
              return;
            }
            if (event.type === "TurnStarted") {
              if (turnStartedListeners.size === 0) return;
              const startedEvent: AgentTurnStartedEvent = {
                session: event.session as Id<"ses">,
                turn: event.payload.turn as Id<"trn">,
              };
              for (const fn of [...turnStartedListeners]) {
                try {
                  fn(startedEvent);
                } catch {
                  // ignore
                }
              }
              return;
            }
            if (event.type !== "TurnEnded") return;
            void service!
              .turnEnded({
                session: event.session as Id<"ses">,
                turn: event.payload.turn as Id<"trn">,
                outcome: event.payload.outcome,
                error: event.payload.error,
              })
              .catch((e) => {
                ctx.telemetry.logger.error({
                  component: "workflows",
                  event: "stall_check_failed",
                  fields: { error: String(e) },
                });
              });

            if (turnEndedListeners.size === 0) return;
            const session = event.session as Id<"ses">;
            const turn = event.payload.turn as Id<"trn">;
            const outcome = event.payload.outcome;
            const status =
              outcome.kind === "completed"
                ? "completed"
                : outcome.kind === "interrupted"
                  ? "stopped"
                  : "failed";
            const errorReason =
              outcome.kind === "completed"
                ? undefined
                : mapTurnOutcomeToReason(outcome, event.payload.error?.code);
            const errorMessage =
              outcome.kind === "completed"
                ? undefined
                : (event.payload.error?.message ??
                  outcome.reason.replaceAll("_", " "));

            void (async () => {
              let lastAssistantText: string | null = null;
              if (status === "completed" && readHelper !== undefined) {
                const answer = await turnAnswer(readHelper, session, turn);
                if (answer.ok) lastAssistantText = answer.value;
              }
              const endedEvent: AgentTurnEndedEvent = {
                session,
                turn,
                status,
                ...(errorReason !== undefined ? { errorReason } : {}),
                ...(errorMessage !== undefined ? { errorMessage } : {}),
                lastAssistantText,
              };
              for (const fn of [...turnEndedListeners]) {
                try {
                  fn(endedEvent);
                } catch {
                  // ignore
                }
              }
            })();
          },
          close() {},
        },
      );
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
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
      turnEndedListeners.clear();
      turnStartedListeners.clear();
      callsSettledListeners.clear();
    },
  };
};
