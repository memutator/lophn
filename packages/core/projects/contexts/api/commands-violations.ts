// context API command: context.record_violations.
import { err, ok } from "../../../../base/mod.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

// 위반 하나를 가리키는 키. 새 위반인지는 이 키의 집합으로 가린다(개수가 아니다).
export const violationKey = (violation: {
  kind: string;
  rule: string | null;
  path: string;
  section: string | null;
}) =>
  JSON.stringify([
    violation.kind,
    violation.rule,
    violation.path,
    violation.section,
  ]);

export function createViolationCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<ContextApiCommands, "recordViolations"> {
  return {
    // 좁은 machine 자격만 낸다. 적용된 판 hash가 맞을 때만 받는다. 위반 수는 마지막 기록으로 남기고,
    // 이전 기록에 없던 위반 키가 하나라도 생기면 ContextViolationFound를 남긴다. 위반이 줄거나
    // 고쳐지는 것은 event가 아니다.
    recordViolations({ actor, key, input }) {
      if (actor.kind !== "machine" || actor.scope !== "context_worker") {
        return err({
          code: "forbidden",
          message: "only the context worker credential records violations",
        });
      }
      return withReplay(state, key, () => {
        const context = state.contexts.get(input.context);
        if (!context) {
          return err({ code: "not_found", message: "context not found" });
        }
        if (context.status !== "active") {
          return err({ code: "conflict", message: "context is not active" });
        }
        const applied = context.applied_bundle === null
          ? undefined
          : state.bundles.get(context.applied_bundle);
        if (!applied || applied.bundle_hash !== input.bundle_hash) {
          return err({
            code: "conflict",
            message: "bundle hash is not the applied bundle",
          });
        }
        if (applied.check === null) {
          return err({
            code: "internal",
            message: "the applied bundle has no check",
          });
        }
        const found = new Set(
          (state.violations.get(context.id) ?? []).map(violationKey),
        );
        const recorded = new Set(deps.recordedViolations(context.id));
        const isNew = [...found].some((violation) => !recorded.has(violation));
        const sameSet = !isNew && found.size === recorded.size;
        if (input.count === context.violation_mark && sameSet) {
          return ok(context);
        }
        deps.keepViolations(context.id, [...found]);
        let revision = context.revision;
        if (isNew) {
          revision = emitEvent(state, deps, {
            type: "ContextViolationFound",
            subject: context.project,
            actor: actor.actor,
            payload: {
              project: context.project,
              context: context.id,
              check: applied.check,
            },
          });
        }
        const next = { ...context, violation_mark: input.count, revision };
        state.contexts.set(next.id, next);
        return ok(next);
      });
    },
  };
}
