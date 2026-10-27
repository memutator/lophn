import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
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
  workflowInstanceApply,
  workflowInstanceCreate,
  type WorkflowState,
} from "../../protocol/workflows/mod.ts";
import { FAILURE_TEXTS, type Router, routerFor } from "../router/mod.ts";
import { afterCommit } from "../storage/ledger/after-commit.ts";
import type { NewLine } from "./rows.ts";
import {
  appendLine,
  type Current,
  insertInstance,
  loadInstance,
  updateInstance,
} from "./store.ts";

// 이 topic을 Bus event WorkflowInstanceChanged로 바꾸는 것은 wf-service의 wiring이다.
export const WORKFLOW_CHANGED_TOPIC = "workflows.changed";

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

type Scope = { tx: Tx; instance: string; at: string; draft: Draft };

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
  const routed = made.value.route(scope.tx, {
    from: { kind: "program" },
    to: delivery.to,
    reply: "none",
    body: delivery.body,
    refs: [],
    reply_to: null,
    dedup: null,
    options: null,
    kind: "step",
    delivery: "next_turn",
    step: { instance: scope.instance as Id<"wfi">, step: plan.step },
    unattended: true,
  });
  if (!routed.ok) return routed;
  if (routed.value.state === "failed") {
    return notHanded("unresolved", FAILURE_TEXTS[routed.value.fail_reason!]);
  }
  const receiver = routed.value.session as Id<"ses">;
  addLine(scope, {
    kind: "handed",
    by: LOPHN,
    step: plan.step,
    participant: plan.participant!,
    receiver,
    human_turn: plan.human_turn,
    cause: plan.cause,
    session: plan.session,
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
      });
      return ok({ steps: next, step: added.name });
    }
    case "update_step": {
      const at = index(edit.name);
      if (at < 0) return fail("not_found", "step not found");
      const next = [...steps];
      // undefined는 덮지 않는다. with: null은 비운다.
      const patch = Object.fromEntries(
        Object.entries(edit.patch).filter(([, v]) => v !== undefined),
      );
      next[at] = { ...next[at]!, ...patch };
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
} {
  function finish(tx: Tx, scope: Scope): Result<WorkflowInstance> {
    const updated = updateInstance(tx.sql, scope.instance, scope.draft);
    if (!updated.ok) return updated;
    const loaded = loadInstance(tx.sql, scope.instance);
    if (!loaded.ok) return loaded;
    const instance = loaded.value!;
    tx.port(afterCommit).push(WORKFLOW_CHANGED_TOPIC, {
      instance: instance.id,
      project: instance.project,
      workflow: instance.workflow,
    });
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
        const at = tx.now();
        insertInstance(tx.sql, {
          id: input.id as Id<"wfi">,
          project: input.project as Id<"prj">,
          workflow: input.workflow,
          input: input.input,
          participants: input.participants,
          steps: input.steps,
          current: null,
          started_by: input.started_by,
          created_at: at,
        });
        const scope: Scope = {
          tx,
          instance: input.id,
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
            line = addLine(scope, {
              kind: "report",
              by: input.by,
              step: change.step,
              text: change.text,
              next: change.next,
              session: change.session,
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
            // 남은 참가자가 없어 아무도 이어 갈 수 없다. 이미 ended·stopped면 줄만 남는다.
            line = addLine(scope, {
              kind: "program_exited",
              by: LOPHN,
              code: change.code,
              stderr_tail: change.stderr_tail,
            });
            endDraft(scope);
            break;
          }
          case "flow_restarted": {
            line = addLine(scope, {
              kind: "lophn_restarted",
              by: LOPHN,
              step: null,
              receiver: null,
            });
            endDraft(scope);
            break;
          }
        }
        const instance = finish(tx, scope);
        return instance.ok
          ? ok({ instance: instance.value, line, handed })
          : instance;
      },
    },
  };
}
