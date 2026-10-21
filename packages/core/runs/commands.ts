import { err, ok, type Result } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import { runCreate, runSettle } from "../../protocol/runs/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
} from "../../protocol/server/mod.ts";
import { insertRun, loadRun, settleRow } from "./store.ts";

function fail(
  code: "forbidden" | "not_found" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

const notMachine = (ctx: RequestContext) =>
  parseActor(ctx.actor)?.kind !== "machine";

export function createRunCommands(): {
  create: CommandDefinition<typeof runCreate>;
  settle: CommandDefinition<typeof runSettle>;
} {
  return {
    create: {
      route: runCreate,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core creates a run");
        }
        if (tx.sql.get("SELECT id FROM runs WHERE id = ?", [input.id])) {
          return fail("conflict", "run id already exists");
        }
        insertRun(tx.sql, { ...input, created_at: tx.now() });
        const run = loadRun(tx.sql, input.id);
        return run.ok ? ok({ run: run.value! }) : run;
      },
    },
    settle: {
      route: runSettle,
      handle(tx, ctx, input, compare) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core settles a run");
        }
        const current = loadRun(tx.sql, input.run);
        if (!current.ok) return current;
        if (current.value === null) return fail("not_found", "run not found");
        if (current.value.state !== compare.state) {
          return fail("conflict", "run is not running");
        }
        const settled = settleRow(tx.sql, {
          id: input.run,
          state: input.state,
          turn: input.turn,
          invocation: input.invocation,
          result: input.state === "done" ? input.result ?? null : undefined,
          error: input.error,
          now: tx.now(),
        });
        if (!settled.ok) return settled;
        const run = loadRun(tx.sql, input.run);
        return run.ok ? ok({ run: run.value! }) : run;
      },
    },
  };
}
