// context API command: bundle.open_draft·discard_draft·submit·finish_check와 검사 통과 때 자동 적용.
// 초안 내용은 ledger에 두지 않는다. 초안 폴더의 bundle.json이 내용이고, submit이 그 내용을 판으로 확정한다.
import { err, ok } from "../../../../base/mod.ts";
import {
  bundleContentSchema,
  type BundleSummary,
} from "../../../../protocol/projects/mod.ts";
import { EMPTY_DRAFT_CONTENT } from "../folders.ts";
import type { ContextApiCommands } from "./commands.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import { reflectSavedViews } from "./commands-bundle-views.ts";
import { makeContext } from "./commands-lifecycle.ts";
import {
  type BundleRow,
  type ContextApiActor,
  type ContextApiDeps,
  type ContextApiState,
  mayWrite,
} from "./state.ts";

type Code = "invalid_input" | "not_found" | "conflict" | "forbidden";
const fail = (code: Code | "internal", message: string) =>
  err({ code, message });

const forbidden = (actor: ContextApiActor) =>
  fail("forbidden", `${actor.kind} cannot write this context`);
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
  | "bundleOpenDraft"
  | "bundleDiscardDraft"
  | "bundleSubmit"
  | "bundleFinishCheck"
> {
  // 새 context이면 첫 판과 함께 context를 만든다. 이미 열린 초안이 있으면 그 폴더를 돌려준다.
  const bundleOpenDraft: ContextApiCommands["bundleOpenDraft"] = (call) => {
    const { actor, input } = call;
    return withReplay(state, call.key, () => {
      let context;
      if ("new" in input) {
        if (!mayWrite(deps, actor, input.new.project)) return forbidden(actor);
        const made = makeContext(state, deps, actor, input.new);
        if (!made.ok) return made;
        context = made.value;
      } else {
        context = state.contexts.get(input.context);
        if (context === undefined) return fail("not_found", "no such context");
        if (!mayWrite(deps, actor, context.project)) return forbidden(actor);
        if (context.status === "archived") {
          return fail("conflict", "an archived context takes no draft");
        }
      }
      const open = [...state.bundles.values()].find((row) =>
        row.context === context.id && row.status === "draft"
      );
      if (open !== undefined) {
        return ok({
          context: context.id,
          bundle: open.id,
          folder: deps.drafts.folder(context.project, context.id, open.id),
        });
      }
      const parent = context.applied_bundle;
      // 새 판은 적용된 판의 내용으로 시작한다. 적용된 판이 없으면 빈 골격이다.
      const initial = parent === null
        ? EMPTY_DRAFT_CONTENT
        : state.bundles.get(parent)?.content ?? EMPTY_DRAFT_CONTENT;
      const id = deps.newId("cbn");
      const seq = emitEvent(state, deps, {
        type: "ContextBundleDraftSaved",
        subject: id,
        actor: actor.actor,
        payload: {
          context: context.id,
          parent,
          content: deps.putBlob(initial),
        },
      });
      state.bundles.set(id, {
        id,
        context: context.id,
        number: null,
        parent,
        bundle_hash: null,
        status: "draft",
        check: null,
        created_by: actor.actor,
        revision: seq,
        content: initial as Record<string, unknown>,
      });
      deps.drafts.create(context.project, context.id, id, initial);
      return ok({
        context: context.id,
        bundle: id,
        folder: deps.drafts.folder(context.project, context.id, id),
      });
    });
  };

  const bundleDiscardDraft: ContextApiCommands["bundleDiscardDraft"] = (
    call,
  ) => {
    const { actor, input, compare } = call;
    return withReplay(state, call.key, () => {
      const current = state.bundles.get(input.bundle);
      if (current === undefined) return fail("not_found", "no such bundle");
      const owner = state.contexts.get(current.context);
      if (owner === undefined) return fail("not_found", "no such context");
      if (!mayWrite(deps, actor, owner.project)) return forbidden(actor);
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
      deps.drafts.remove(owner.project, owner.id, current.id);
      return ok(summaryOf(row));
    });
  };

  const bundleSubmit: ContextApiCommands["bundleSubmit"] = (call) => {
    const { actor, input } = call;
    return withReplay(state, call.key, () => {
      const current = state.bundles.get(input.bundle);
      if (current === undefined) return fail("not_found", "no such bundle");
      const context = state.contexts.get(current.context);
      if (context === undefined) return fail("not_found", "no such context");
      if (!mayWrite(deps, actor, context.project)) return forbidden(actor);
      if (current.status !== "draft") {
        return fail("conflict", "only a draft can be submitted");
      }
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
      const folder = deps.drafts.read(context.project, context.id, current.id);
      if (!folder.ok) return folder;
      const parsed = bundleContentSchema.safeParse(folder.value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return fail(
          "invalid_input",
          `bundle.json is not a BundleContent: ${issue?.path.join(".") ?? ""} ${
            issue?.message ?? ""
          }`.trim(),
        );
      }
      const content = parsed.data;
      deps.putBlob(content);
      const bundleHash = deps.hash(content);
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
        content,
      };
      state.bundles.set(row.id, row);
      deps.drafts.remove(context.project, context.id, current.id);
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
    bundleOpenDraft,
    bundleDiscardDraft,
    bundleSubmit,
    bundleFinishCheck,
  };
}
