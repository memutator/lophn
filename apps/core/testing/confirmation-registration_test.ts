import { z } from "zod";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  ACTOR_KINDS,
  defineCommand,
} from "../../../packages/contracts/platform/mod.ts";
import type { LedgerTestRegistration } from "./ledger.ts";

const input = z.strictObject({
  target: z.string().min(1),
  content: z.string().min(1),
});

export const guardedRoute = defineCommand({
  resource: "guarded",
  method: "apply",
  name: "guarded_apply",
  input,
  output: z.strictObject({ applied: z.boolean() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["forbidden", "conflict"],
  confirmation: "required",
  binding: ["target", "content"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  return {
    schemaSteps: [{
      id: "confirmation-probe",
      sql: "create table confirmation_probe (id integer primary key)",
    }],
    testCommands: [{
      route: guardedRoute,
      handle(tx, _ctx, input) {
        const content = (input as { content: string }).content;
        tx.sql.run("insert into confirmation_probe (id) values (1)", []);
        if (content === "fail") {
          return err({ code: "conflict", message: "forced failure" });
        }
        return ok({ applied: true });
      },
    }],
  };
}
