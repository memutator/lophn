// context API command: context.record_violations·hand_off_violations.
import { err, ok } from "../../../base/mod.ts";
import type { StoredViolation } from "../../../contracts/documents/mod.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import {
  buildEvidence,
  keyOfViolation,
  sameViolationKey,
} from "./commands-violations-evidence.ts";
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

export function createViolationCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<ContextApiCommands, "recordViolations" | "handOffViolations"> {
  return {
    // 좁은 machine 자격만 낸다. 위반 수가 마지막 기록과 다르고 적용된 판 hash가 맞을 때만 받는다.
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
        if (input.count === context.violation_mark) {
          return err({
            code: "conflict",
            message: "violation count is already recorded",
          });
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
        const seq = emitEvent(state, deps, {
          type: "ContextViolationsRecorded",
          subject: context.id,
          actor: actor.actor,
          payload: {
            before: context.violation_mark,
            after: input.count,
            bundle_hash: input.bundle_hash,
          },
        });
        const next = { ...context, violation_mark: input.count, revision: seq };
        state.contexts.set(next.id, next);
        return ok(next);
      });
    },

    // 사람 한 번의 요청이 위반과 서버가 만든 근거를 Context Engineer의 Run 하나로 넘긴다.
    handOffViolations({ actor, key, input }) {
      if (actor.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the user hands violations off",
        });
      }
      return withReplay(state, key, () => {
        const context = state.contexts.get(input.context);
        if (!context) {
          return err({ code: "not_found", message: "context not found" });
        }
        if (context.status !== "active") {
          return err({
            code: "invalid_input",
            message: "context is not active",
          });
        }
        const stored = state.violations.get(context.id) ?? [];
        let chosen: StoredViolation[];
        if (input.violations === undefined) {
          chosen = [...stored];
        } else {
          chosen = [];
          for (const wanted of input.violations) {
            const found = stored.find((row) =>
              sameViolationKey(keyOfViolation(row), wanted)
            );
            if (!found) {
              return err({
                code: "invalid_input",
                message: "violation is not in the context",
                details: { path: wanted.path },
              });
            }
            if (chosen.includes(found)) {
              return err({
                code: "invalid_input",
                message: "duplicate violation key",
              });
            }
            chosen.push(found);
          }
        }
        if (chosen.length === 0) {
          return err({
            code: "invalid_input",
            message: "there are no violations to hand off",
          });
        }
        const evidence = deps.putBlob(buildEvidence(state, context, chosen));
        const run = deps.startHandOffRun({
          context: context.id,
          evidence,
          violations: chosen,
        });
        emitEvent(state, deps, {
          type: "ContextViolationsHandedOff",
          subject: context.id,
          actor: actor.actor,
          payload: { violations: chosen.map(keyOfViolation), evidence, run },
        });
        return ok({ context: context.id, run, violation_count: chosen.length });
      });
    },
  };
}
