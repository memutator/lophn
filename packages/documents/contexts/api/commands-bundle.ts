// context API command: bundle.save_draft·discard_draft·submit·finish_check와 검사 통과 때 자동 적용.
import { err, ok } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  type BundleSummary,
} from "../../../contracts/documents/mod.ts";
import type { ContextApiCommands } from "./commands.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import { reflectSavedViews } from "./commands-bundle-views.ts";
import type {
  BundleRow,
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";

type Code = "invalid_input" | "not_found" | "conflict" | "forbidden";
const fail = (code: Code | "internal", message: string) =>
  err({ code, message });

const isEngineer = (actor: ContextApiActor) =>
  actor.kind === "agent" && actor.role === "context_engineer";
const isWorker = (actor: ContextApiActor) =>
  actor.kind === "machine" && actor.scope === "context_worker";

function summaryOf(row: BundleRow): BundleSummary {
  const { content: _content, ...summary } = row;
  return summary;
}

export function createBundleCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<
  ContextApiCommands,
  | "bundleSaveDraft"
  | "bundleDiscardDraft"
  | "bundleSubmit"
  | "bundleFinishCheck"
> {
  const bundleSaveDraft: ContextApiCommands["bundleSaveDraft"] = (call) => {
    if (!isEngineer(call.actor)) {
      return fail("forbidden", "only the Context Engineer saves drafts");
    }
    const { actor, input, compare } = call;
    return withReplay(state, call.key, () => {
      const context = state.contexts.get(input.context);
      if (context === undefined) return fail("not_found", "no such context");
      if (context.status === "archived") {
        return fail("conflict", "an archived context takes no draft");
      }
      if (input.bundle === undefined) {
        if (compare.base_revision !== undefined) {
          return fail("invalid_input", "a new draft takes no base_revision");
        }
        const open = [...state.bundles.values()].some((row) =>
          row.context === context.id && row.status === "draft"
        );
        if (open) {
          return fail("conflict", "the context already has a draft");
        }
        const id = deps.newId("cbn");
        const parent = context.applied_bundle;
        const seq = emitEvent(state, deps, {
          type: "ContextBundleDraftSaved",
          subject: id,
          actor: actor.actor,
          payload: {
            context: context.id,
            parent,
            content: deps.putBlob(input.content),
          },
        });
        const row: BundleRow = {
          id,
          context: context.id,
          number: null,
          parent,
          bundle_hash: null,
          status: "draft",
          check: null,
          created_by: actor.actor,
          revision: seq,
          content: input.content,
        };
        state.bundles.set(id, row);
        return ok(summaryOf(row));
      }
      if (compare.base_revision === undefined) {
        return fail("invalid_input", "editing a draft needs base_revision");
      }
      const current = state.bundles.get(input.bundle);
      if (current === undefined || current.context !== context.id) {
        return fail("not_found", "no such bundle in the context");
      }
      if (current.status !== "draft") {
        return fail("conflict", "only a draft can be saved over");
      }
      if (current.revision !== compare.base_revision) {
        return fail("conflict", "the draft changed since base_revision");
      }
      const seq = emitEvent(state, deps, {
        type: "ContextBundleDraftSaved",
        subject: current.id,
        actor: actor.actor,
        payload: {
          context: context.id,
          parent: current.parent,
          content: deps.putBlob(input.content),
        },
      });
      const row: BundleRow = {
        ...current,
        content: input.content,
        revision: seq,
      };
      state.bundles.set(row.id, row);
      return ok(summaryOf(row));
    });
  };

  const bundleDiscardDraft: ContextApiCommands["bundleDiscardDraft"] = (
    call,
  ) => {
    if (call.actor.kind !== "user" && !isEngineer(call.actor)) {
      return fail("forbidden", "only the user or the Context Engineer");
    }
    const { actor, input, compare } = call;
    return withReplay(state, call.key, () => {
      const current = state.bundles.get(input.bundle);
      if (current === undefined) return fail("not_found", "no such bundle");
      if (current.status !== "draft") {
        return fail("conflict", "only a draft can be discarded");
      }
      if (current.revision !== compare.base_revision) {
        return fail("conflict", "the draft changed since base_revision");
      }
      const seq = emitEvent(state, deps, {
        type: "ContextBundleDraftDiscarded",
        subject: current.id,
        actor: actor.actor,
        payload: { context: current.context },
      });
      const row: BundleRow = { ...current, status: "discarded", revision: seq };
      state.bundles.set(row.id, row);
      return ok(summaryOf(row));
    });
  };

  const bundleSubmit: ContextApiCommands["bundleSubmit"] = (call) => {
    if (!isEngineer(call.actor)) {
      return fail("forbidden", "only the Context Engineer submits bundles");
    }
    const { actor, input } = call;
    return withReplay(state, call.key, () => {
      const current = state.bundles.get(input.bundle);
      if (current === undefined) return fail("not_found", "no such bundle");
      if (current.status !== "draft") {
        return fail("conflict", "only a draft can be submitted");
      }
      const context = state.contexts.get(current.context);
      if (context === undefined) return fail("not_found", "no such context");
      if (context.status === "archived") {
        return fail("conflict", "an archived context takes no submit");
      }
      let number = 0;
      for (const row of state.bundles.values()) {
        if (row.context !== context.id) continue;
        if (row.status === "checking") {
          return fail("conflict", "another bundle is being checked");
        }
        number = Math.max(number, row.number ?? 0);
      }
      number += 1;
      if (!bundleContentSchema.safeParse(current.content).success) {
        return fail("invalid_input", "content is not a BundleContent");
      }
      const bundleHash = deps.hash(current.content);
      const checkId = deps.newId("chk");
      const seq = emitEvent(state, deps, {
        type: "ContextBundleSubmitted",
        subject: current.id,
        actor: actor.actor,
        payload: {
          context: context.id,
          number,
          bundle_hash: bundleHash,
          check: checkId,
        },
      });
      state.checks.set(checkId, {
        id: checkId,
        context: context.id,
        bundle: current.id,
        status: "running",
        snapshot_hash: null,
        findings: [],
        violation_count: null,
        started_at: deps.now(),
        finished_at: null,
      });
      const row: BundleRow = {
        ...current,
        number,
        bundle_hash: bundleHash,
        status: "checking",
        check: checkId,
        revision: seq,
      };
      state.bundles.set(row.id, row);
      return ok(summaryOf(row));
    });
  };

  const bundleFinishCheck: ContextApiCommands["bundleFinishCheck"] = (
    call,
  ) => {
    if (!isWorker(call.actor)) {
      return fail("forbidden", "only the context worker reports checks");
    }
    const { actor, input } = call;
    return withReplay(state, call.key, () => {
      const check = state.checks.get(input.check);
      if (check === undefined) return fail("not_found", "no such check");
      if (check.status !== "running") {
        return fail("conflict", "the check already has a result");
      }
      const bundle = state.bundles.get(check.bundle);
      const context = state.contexts.get(check.context);
      if (bundle === undefined || context === undefined) {
        return fail("internal", "the check has no bundle or context");
      }
      if (bundle.status !== "checking") {
        return fail("conflict", "the bundle is not being checked");
      }
      if (bundle.bundle_hash !== input.bundle_hash) {
        return fail("conflict", "bundle_hash is not the submitted bundle's");
      }
      const passed = input.result === "passed";
      if (passed !== (input.findings.length === 0)) {
        return fail(
          "invalid_input",
          "failed needs findings; passed has none",
        );
      }
      const number = bundle.number!;
      const finished = {
        ...check,
        status: input.result,
        snapshot_hash: input.snapshot_hash,
        findings: input.findings,
        violation_count: input.violation_count,
        finished_at: deps.now(),
      };
      if (!passed) {
        const seq = emitEvent(state, deps, {
          type: "ContextBundleCheckFailed",
          subject: bundle.id,
          actor: actor.actor,
          payload: {
            context: context.id,
            number,
            check: check.id,
            findings: input.findings,
          },
        });
        const row: BundleRow = { ...bundle, status: "failed", revision: seq };
        state.bundles.set(row.id, row);
        state.checks.set(finished.id, finished);
        return ok({ context, bundle: summaryOf(row), check: finished });
      }
      const parsed = bundleContentSchema.safeParse(bundle.content);
      if (!parsed.success) {
        return fail("internal", "a checked bundle's content is not valid");
      }
      const previous = context.applied_bundle;
      const seq = emitEvent(state, deps, {
        type: "ContextBundleApplied",
        subject: bundle.id,
        actor: actor.actor,
        payload: {
          context: context.id,
          number,
          previous_applied: previous,
          check: check.id,
          violation_count: input.violation_count,
        },
      });
      const previousRow = previous === null
        ? undefined
        : state.bundles.get(previous);
      if (previousRow !== undefined) {
        state.bundles.set(previousRow.id, {
          ...previousRow,
          status: "superseded",
          revision: seq,
        });
      }
      const row: BundleRow = { ...bundle, status: "applied", revision: seq };
      state.bundles.set(row.id, row);
      state.checks.set(finished.id, finished);
      // 보관된 context는 보관 상태를 지키고 적용된 판만 바뀐다.
      const nextContext = {
        ...context,
        status: context.status === "archived" ? context.status : "active",
        applied_bundle: bundle.id,
        revision: seq,
      } as typeof context;
      state.contexts.set(nextContext.id, nextContext);
      reflectSavedViews(
        state,
        deps,
        context.id,
        actor.actor,
        parsed.data.saved_views,
      );
      return ok({
        context: nextContext,
        bundle: summaryOf(row),
        check: finished,
      });
    });
  };

  return {
    bundleSaveDraft,
    bundleDiscardDraft,
    bundleSubmit,
    bundleFinishCheck,
  };
}
