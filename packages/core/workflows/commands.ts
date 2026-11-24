import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import {
  type HandoffPlan,
  type HandResult,
  type InstanceStep,
  type NotHandedReason,
  type WorkflowEdit,
  type WorkflowInstance,
  type WorkflowState,
  workflowCheckpointUpsert,
  workflowInstanceApply,
  workflowInstanceCreate,
} from "../../protocol/workflows/mod.ts";
import { FAILURE_TEXTS, type Router, routerFor } from "../router/mod.ts";
import {
  WORKFLOW_SNAPSHOT_BLOB_FIELD_NAME,
  WORKFLOW_SNAPSHOT_BLOB_OWNER_KIND,
  WORKFLOW_SNAPSHOT_BLOB_PURPOSE,
} from "./checkpoint-schema.ts";
import { upsertCheckpointRow } from "./checkpoints.ts";
import { remoteCallsOf } from "./remote.ts";
import type { NewLine } from "./rows.ts";
import { EMPTY_FILE_SHA256, parseSnapshotManifest } from "./snapshot.ts";
import {
  appendLine,
  type Current,
  hasTable,
  insertInstance,
  loadInstance,
  updateInstance,
} from "./store.ts";

function registerSnapshotBlobRefs(
  tx: Tx,
  ctx: RequestContext,
  instance: string,
  manifestJson: string | null | undefined,
): Result<void> {
  if (
    manifestJson === undefined ||
    manifestJson === null ||
    typeof tx.registerBlobRef !== "function" ||
    !hasTable(tx.sql, "blob_refs")
  ) {
    return ok(undefined);
  }
  const parsed = parseSnapshotManifest(manifestJson);
  if (!parsed.ok) return parsed;
  const seen = new Set<string>();
  for (const file of parsed.value.files) {
    if (
      file.size_bytes === undefined ||
      file.size_bytes === 0 ||
      file.blob_id === EMPTY_FILE_SHA256 ||
      seen.has(file.blob_id)
    ) {
      continue;
    }
    seen.add(file.blob_id);
    const exists = tx.sql.get(
      `SELECT 1 AS found FROM blob_refs
       WHERE owner_kind = ? AND owner_key = ? AND field = ? AND hash = ?`,
      [
        WORKFLOW_SNAPSHOT_BLOB_OWNER_KIND,
        instance,
        WORKFLOW_SNAPSHOT_BLOB_FIELD_NAME,
        file.blob_id,
      ],
    );
    if (exists !== undefined) continue;
    const registered = tx.registerBlobRef({
      owner_kind: WORKFLOW_SNAPSHOT_BLOB_OWNER_KIND,
      owner_key: instance,
      field: WORKFLOW_SNAPSHOT_BLOB_FIELD_NAME,
      registered_seq: "1",
      source: {
        kind: "prepared",
        blob: {
          preparation: file.blob_id,
          principal: ctx.principal,
          purpose: WORKFLOW_SNAPSHOT_BLOB_PURPOSE,
          hash: file.blob_id,
          size_bytes: file.size_bytes,
        },
      },
    });
    if (!registered.ok) return registered;
  }
  return ok(undefined);
}

function fail(
  code: "forbidden" | "not_found" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

const notMachine = (ctx: RequestContext) =>
  parseActor(ctx.actor)?.kind !== "machine";

const LOPHN = { kind: "lophn" } as const;

// 한 command 동안 메모리에 모은 변화다. 끝에 updateInstance를 한 번 부른다.
type Draft = {
  state: WorkflowState;
  current: Current;
  steps: InstanceStep[];
  finished_at: string | null;
};

type Scope = {
  tx: Tx;
  instance: string;
  // 다른 컴퓨터로 넘기는 mail의 이름과 보내는 workspace.
  workflow: string;
  project: string;
  at: string;
  draft: Draft;
};

const addLine = (scope: Scope, line: NewLine) =>
  appendLine(scope.tx.sql, scope.instance, scope.at, line);

// running이었을 때만 끝을 기록한다. 같은 끝을 두 번 남기지 않는다.
function endDraft(scope: Scope): void {
  if (scope.draft.state !== "running") return;
  addLine(scope, { kind: "ended", by: LOPHN });
  scope.draft.state = "ended";
  scope.draft.current = null;
  scope.draft.finished_at = scope.at;
}

// create·report·hand_now가 같이 쓴다. Router가 err를 주면 그대로 올려 tx를 되돌린다.
function handOff(
  scope: Scope,
  router: (tx: Tx) => Result<Router>,
  plan: HandoffPlan,
): Result<HandResult> {
  const notHanded = (
    reason: NotHandedReason,
    message: string,
  ): Result<HandResult> => {
    addLine(scope, {
      kind: "not_handed",
      by: LOPHN,
      step: plan.step,
      reason,
      message,
    });
    return ok({ step: plan.step, outcome: "not_handed", reason, message });
  };
  if (plan.unresolved !== null) {
    return notHanded(plan.unresolved.reason, plan.unresolved.message);
  }
  const delivery = plan.delivery!;
  const made = router(scope.tx);
  if (!made.ok) return made;
  if ("remote" in delivery) {
    // 다른 컴퓨터의 참가자: call mail로 낸다. 받은 session은 그 컴퓨터가 받은 뒤에 안다.
    const sent = made.value.sendStep(scope.tx, {
      instance: scope.instance,
      step: plan.step,
      workflow: scope.workflow,
      workspace: { kind: "project", id: scope.project },
      peer: {
        machine: delivery.remote.machine,
        computer: delivery.remote.computer,
      },
      address: delivery.remote.address,
      body: textBlocks(delivery.body),
    });
    // 넘길 수 없는 step(redaction 뒤 64 KiB를 넘는 글, 그 사이 private이 된 project)은 이 컴퓨터의 넘기기처럼 not_handed 줄이다.
    // 다른 컴퓨터에서 온 report도 줄은 남고 다음 step만 넘기지 못한다.
    if (!sent.ok) {
      if (
        sent.error.code !== "invalid_input" &&
        sent.error.code !== "forbidden"
      ) {
        return sent;
      }
      return notHanded("unresolved", sent.error.message);
    }
    return handed(scope, plan, null, {
      machine: delivery.remote.machine,
      computer: delivery.remote.computer,
      call: sent.value.call,
    });
  }
  const routed = made.value.route(scope.tx, {
    from: { kind: "program" },
    to: delivery.to,
    reply: "none",
    body: textBlocks(delivery.body),
    refs: [],
    reply_to: null,
    dedup: null,
    kind: "step",
    delivery: "next_turn",
    step: { instance: scope.instance as Id<"wfi">, step: plan.step },
    workflowOrigin: {
      project: scope.project as Id<"prj">,
      workflow: scope.workflow,
      instance: scope.instance as Id<"wfi">,
      step: plan.step,
    },
    ...(plan.open !== undefined ? { open: plan.open } : {}),
    // 사람 step(by: me / human())은 사람이 바로 대화·질문(ask)·승인에 답하는 자리이므로 attended turn으로 연다.
    unattended: !plan.human_turn,
  });
  if (!routed.ok) return routed;
  if (routed.value.state === "failed") {
    return notHanded("unresolved", FAILURE_TEXTS[routed.value.fail_reason!]);
  }
  return handed(scope, plan, routed.value.session as Id<"ses">, null);
}

function handed(
  scope: Scope,
  plan: HandoffPlan,
  receiver: Id<"ses"> | null,
  remote: { machine: string; computer: string; call: string } | null,
): Result<HandResult> {
  addLine(scope, {
    kind: "handed",
    by: LOPHN,
    step: plan.step,
    participant: plan.participant!,
    receiver,
    human_turn: plan.human_turn,
    cause: plan.cause,
    session: plan.session,
    remote,
  });
  scope.draft.current = { step: plan.step, human_turn: plan.human_turn };
  // ended는 넘긴 뒤에만 running으로 돌아온다. 못 넘긴 고치기가 아무도 일하지 않는 running을 만들지 않는다.
  if (scope.draft.state === "ended") {
    scope.draft.state = "running";
    scope.draft.finished_at = null;
  }
  return ok({
    step: plan.step,
    outcome: "handed",
    receiver,
    human_turn: plan.human_turn,
  });
}

function editSteps(
  steps: InstanceStep[],
  edit: WorkflowEdit,
): Result<{ steps: InstanceStep[]; step: string | null }> {
  const index = (name: string) => steps.findIndex((s) => s.name === name);
  switch (edit.op) {
    case "add_step": {
      const added = edit.step;
      if (index(added.name) >= 0) {
        return fail("conflict", "step name already exists");
      }
      const next = [...steps];
      let at = next.length;
      if (edit.after !== undefined) {
        const after = index(edit.after);
        if (after < 0) return fail("not_found", "step not found");
        at = after + 1;
      }
      next.splice(at, 0, {
        name: added.name,
        by: added.by,
        with: added.with ?? null,
        prompt: added.prompt,
        in: added.in ?? "",
        out: added.out ?? "",
        next: added.next ?? [],
        ...(added.open !== undefined ? { open: added.open } : {}),
      });
      return ok({ steps: next, step: added.name });
    }
    case "update_step": {
      const at = index(edit.name);
      if (at < 0) return fail("not_found", "step not found");
      const next = [...steps];
      // undefined는 덮지 않는다. with: null은 비운다. open: null은 지운다.
      const patch = Object.fromEntries(
        Object.entries(edit.patch).filter(
          ([k, v]) => v !== undefined && !(k === "open" && v === null),
        ),
      );
      const updated = { ...next[at]!, ...patch };
      if (edit.patch.open === null) delete updated.open;
      next[at] = updated;
      return ok({ steps: next, step: edit.name });
    }
    case "remove_step": {
      const at = index(edit.name);
      if (at < 0) return fail("not_found", "step not found");
      return ok({ steps: steps.filter((_, i) => i !== at), step: edit.name });
    }
    case "end":
      return ok({ steps, step: null });
    case "hand_now":
      return ok({ steps, step: edit.step });
  }
}

export function createWorkflowCommands(
  router: (tx: Tx) => Result<Router> = routerFor,
): {
  create: CommandDefinition<typeof workflowInstanceCreate>;
  apply: CommandDefinition<typeof workflowInstanceApply>;
  upsertCheckpoint: CommandDefinition<typeof workflowCheckpointUpsert>;
} {
  function finish(tx: Tx, scope: Scope): Result<WorkflowInstance> {
    const updated = updateInstance(tx.sql, scope.instance, scope.draft);
    if (!updated.ok) return updated;
    const loaded = loadInstance(tx.sql, scope.instance);
    if (!loaded.ok) return loaded;
    const instance = loaded.value!;
    return ok(instance);
  }

  return {
    create: {
      route: workflowInstanceCreate,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core creates a workflow instance");
        }
        if (
          tx.sql.get("SELECT id FROM workflow_instances WHERE id = ?", [
            input.id,
          ])
        ) {
          return fail("conflict", "workflow instance id already exists");
        }
        const registered = registerSnapshotBlobRefs(
          tx,
          ctx,
          input.id,
          input.code_snapshot,
        );
        if (!registered.ok) return registered;
        const at = tx.now();
        insertInstance(tx.sql, {
          id: input.id as Id<"wfi">,
          project: input.project as Id<"prj">,
          workflow: input.workflow,
          input: input.input,
          ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
          ...(input.code_snapshot !== undefined
            ? { code_snapshot: input.code_snapshot }
            : {}),
          ...(input.open_mode !== undefined
            ? { open_mode: input.open_mode }
            : {}),
          participants: input.participants,
          steps: input.steps,
          current: null,
          started_by: input.started_by,
          created_at: at,
        });
        const scope: Scope = {
          tx,
          instance: input.id,
          workflow: input.workflow,
          project: input.project,
          at,
          draft: {
            state: "running",
            current: null,
            steps: input.steps,
            finished_at: null,
          },
        };
        addLine(scope, {
          kind: "started",
          by: input.started_by,
          step: input.handoff?.step ?? null,
          text: input.input,
        });
        const handed =
          input.handoff === null
            ? ok(null)
            : handOff(scope, router, input.handoff);
        if (!handed.ok) return handed;
        const instance = finish(tx, scope);
        return instance.ok
          ? ok({ instance: instance.value, handed: handed.value })
          : instance;
      },
    },
    apply: {
      route: workflowInstanceApply,
      handle(tx, ctx, input, compare) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core changes a workflow instance");
        }
        const loaded = loadInstance(tx.sql, input.instance);
        if (!loaded.ok) return loaded;
        const current = loaded.value;
        if (current === null) {
          return fail("not_found", "workflow instance not found");
        }
        if (current.state_seq !== compare.state_seq) {
          return fail("conflict", "workflow instance changed");
        }
        const scope: Scope = {
          tx,
          instance: input.instance,
          workflow: current.workflow,
          project: current.project,
          at: tx.now(),
          draft: {
            state: current.state,
            current: current.current,
            steps: current.steps,
            finished_at: current.finished_at,
          },
        };
        const stopped = current.state === "stopped";
        // stopped면 넘기지 않는다. 늦게 온 report의 줄만 남긴다.
        const plan = stopped ? null : input.handoff;
        const change = input.change;
        let line: string;
        let handed: HandResult | null = null;
        const hand = (): Result<void> => {
          if (plan === null) return ok(undefined);
          const done = handOff(scope, router, plan);
          if (!done.ok) return done;
          handed = done.value;
          return ok(undefined);
        };
        switch (change.kind) {
          case "report": {
            // 다른 컴퓨터의 참가자가 낸 report: 그 step을 넘긴 call의 reply mail이어야 하고 한 번만 적용한다.
            if (input.mail !== undefined) {
              const made = router(tx);
              if (!made.ok) return made;
              const accepted = made.value.acceptStepReport(tx, input.mail);
              if (!accepted.ok) return accepted;
            }
            line = addLine(scope, {
              kind: "report",
              by: input.by,
              step: change.step,
              text: change.text,
              next: change.next,
              session: change.session,
              ...(change.refs !== undefined ? { refs: change.refs } : {}),
              ...(change.data !== undefined ? { data: change.data } : {}),
            });
            if (input.by.kind === "program") {
              // flow는 넘기지 않는다. stopped나 ended 뒤의 report는 줄만 남고 다시 running이 되지 않는다.
              if (scope.draft.state === "running") {
                scope.draft.current = {
                  step: change.step,
                  human_turn: false,
                };
                if (change.next === "end") endDraft(scope);
              }
              break;
            }
            if (stopped || change.next === null) break;
            if (change.next === "end") {
              endDraft(scope);
              break;
            }
            const done = hand();
            if (!done.ok) return done;
            break;
          }
          case "edit": {
            if (stopped) {
              return fail("conflict", "workflow instance is stopped");
            }
            const edited = editSteps(scope.draft.steps, change.edit);
            if (!edited.ok) return edited;
            scope.draft.steps = edited.value.steps;
            line = addLine(scope, {
              kind: "edit",
              by: input.by,
              op: change.edit.op,
              step: edited.value.step,
              detail: change.edit,
            });
            if (change.edit.op === "end") {
              endDraft(scope);
            } else if (change.edit.op === "hand_now") {
              const done = hand();
              if (!done.ok) return done;
            }
            break;
          }
          case "stop": {
            if (stopped) {
              return fail("conflict", "workflow instance is stopped");
            }
            line = addLine(scope, {
              kind: "stopped",
              by: input.by as { kind: "user" },
            });
            // 다른 컴퓨터로 넘긴 열린 step을 거둔다(낼 call mail을 지우고 cancel mail을 낸다). 끝난 call은 그대로다.
            const calls = remoteCallsOf(tx.sql, input.instance);
            if (calls.length > 0) {
              const made = router(tx);
              if (!made.ok) return made;
              for (const call of calls) {
                const withdrawn = made.value.cancel(
                  tx,
                  { kind: "human" },
                  { call },
                );
                if (!withdrawn.ok) return withdrawn;
              }
            }
            scope.draft.state = "stopped";
            scope.draft.current = scope.draft.current && {
              step: scope.draft.current.step,
              human_turn: false,
            };
            scope.draft.finished_at ??= scope.at;
            break;
          }
          case "lophn_restarted": {
            line = addLine(scope, {
              kind: "lophn_restarted",
              by: LOPHN,
              step: change.step,
              receiver: change.receiver,
            });
            break;
          }
          case "program_exited": {
            // 정상 종료(code === 0)만 ended로 닫는다. 비정상 종료·미처리 예외는 running을 유지해 blocked + Resume 가능으로 둔다.
            line = addLine(scope, {
              kind: "program_exited",
              by: LOPHN,
              code: change.code,
              stderr_tail: change.stderr_tail,
            });
            if (change.code === 0) {
              endDraft(scope);
            }
            break;
          }
          case "flow_restarted": {
            // 재시작으로 끊긴 flow instance는 lophn_restarted 줄을 남기고 running(blocked)으로 둔다.
            line = addLine(scope, {
              kind: "lophn_restarted",
              by: LOPHN,
              step: null,
              receiver: null,
            });
            break;
          }
          case "step_stalled": {
            line = addLine(scope, {
              kind: "step_stalled",
              by: LOPHN,
              step: change.step,
              session: change.session,
              ...(change.reason !== undefined ? { reason: change.reason } : {}),
              ...(change.message !== undefined
                ? { message: change.message }
                : {}),
            });
            break;
          }
          case "retried": {
            if (scope.draft.state !== "running") {
              return fail("conflict", "workflow instance is not running");
            }
            line = addLine(scope, {
              kind: "retried",
              by: { kind: "user" },
              step: change.step,
              session: change.session,
            });
            if (change.session !== null && change.body !== undefined) {
              const made = router(tx);
              if (!made.ok) return made;
              // 기록된 같은 session에만 넣는다(fallback: "new" 없음 — 새 session으로 처음부터 돌리지 않는다).
              const routed = made.value.route(tx, {
                from: { kind: "program" },
                to: { session: change.session as Id<"ses"> },
                reply: "none",
                body: textBlocks(change.body),
                refs: [],
                reply_to: null,
                dedup: null,
                kind: "step",
                delivery: "next_turn",
                step: {
                  instance: scope.instance as Id<"wfi">,
                  step: change.step,
                },
                workflowOrigin: {
                  project: scope.project as Id<"prj">,
                  workflow: scope.workflow,
                  instance: scope.instance as Id<"wfi">,
                  step: change.step,
                },
                unattended: !(
                  scope.draft.current?.step === change.step &&
                  scope.draft.current.human_turn
                ),
              });
              if (!routed.ok) return routed;
              if (routed.value.state === "failed") {
                return fail(
                  "conflict",
                  FAILURE_TEXTS[routed.value.fail_reason!],
                );
              }
            } else if (change.session === null) {
              const done = hand();
              if (!done.ok) return done;
            }
            break;
          }
          case "code_updated": {
            if (stopped) {
              return fail("conflict", "workflow instance is stopped");
            }
            const registered = registerSnapshotBlobRefs(
              tx,
              ctx,
              input.instance,
              change.code_snapshot,
            );
            if (!registered.ok) return registered;
            tx.sql.run(
              "UPDATE workflow_instances SET code_snapshot = ? WHERE id = ?",
              [change.code_snapshot, input.instance],
            );
            line = addLine(scope, {
              kind: "code_updated",
              by: { kind: "user" },
            });
            break;
          }
          case "escalated": {
            if (stopped) {
              return fail("conflict", "workflow instance is stopped");
            }
            line = addLine(scope, {
              kind: "escalated",
              by: input.by,
              step: change.step,
              text: change.text,
            });
            break;
          }
          case "handoff": {
            if (stopped) {
              return fail("conflict", "workflow instance is stopped");
            }
            if (plan === null) {
              return fail("conflict", "handoff plan is required");
            }
            const done = hand();
            if (!done.ok) return done;
            const lastSeq = tx.sql.get(
              "SELECT max(seq) AS seq FROM workflow_lines WHERE instance = ?",
              [input.instance],
            );
            line = String(lastSeq?.["seq"] ?? 1);
            break;
          }
        }
        const instance = finish(tx, scope);
        return instance.ok
          ? ok({ instance: instance.value, line, handed })
          : instance;
      },
    },
    upsertCheckpoint: {
      route: workflowCheckpointUpsert,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core writes a workflow checkpoint");
        }
        const loaded = loadInstance(tx.sql, input.instance);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return fail("not_found", "workflow instance not found");
        }
        const upserted = upsertCheckpointRow(tx.sql, {
          instance: input.instance,
          key: input.key,
          kind: input.kind,
          state: input.state,
          ...(input.handle_ref !== undefined
            ? { handle_ref: input.handle_ref }
            : {}),
          ...(input.output !== undefined ? { output: input.output } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          at: tx.now(),
        });
        return upserted.ok ? ok({ checkpoint: upserted.value }) : upserted;
      },
    },
  };
}
