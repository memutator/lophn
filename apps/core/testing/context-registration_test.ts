import { z } from "zod";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  ACTOR_KINDS,
  defineCommand,
} from "../../../packages/contracts/platform/mod.ts";
import type { LedgerTestRegistration } from "./ledger.ts";

const input = z.object({ mutate: z.boolean() });
const output = z.object({ registered: z.boolean() });
const route = defineCommand({
  resource: "context",
  method: "create",
  name: "context.create",
  input,
  output,
  actors: ACTOR_KINDS,
  errors: ["forbidden", "unavailable"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  return {
    schemaSteps: [{
      id: "context-tables",
      sql:
        "create table contexts(value text); create table context_refs(value text, registered_seq integer references events(seq));",
    }],
    commands: [{
      route,
      handle(tx, ctx, raw) {
        const parsed = input.parse(raw);
        tx.sql.run("insert into contexts values (?)", [ctx.principal]);
        if (parsed.mutate) {
          ctx.principal = "forged";
          ctx.actor = "machine";
          ctx.scope.operations.push("forged.operation");
          ctx.conditions.mode = "forged";
        }
        const seq = tx.emit(
          { type: "ContextCreated", payload: z.object({}) },
          "context:one",
          {},
        );
        for (const purpose of ["first", "second"]) {
          const result = tx.registerBlobRef({
            owner_kind: "context",
            owner_key: purpose,
            field: "body",
            registered_seq: seq,
            source: {
              kind: "prepared",
              blob: {
                preparation: "prepared",
                principal: ctx.principal,
                purpose,
                hash: "a".repeat(64),
                size_bytes: 1,
              },
            },
          });
          if (!result.ok) return result;
        }
        return ok({ registered: true });
      },
    }],
    registerBlobRef(tx, ctx, reference) {
      if (
        reference.source.kind !== "prepared" ||
        reference.source.blob.principal !== ctx.principal ||
        ctx.actor !== "user" || ctx.conditions.mode !== "current" ||
        ctx.scope.operations.includes("forged.operation")
      ) {
        return err({
          code: "forbidden",
          message: "current blob context가 아니다",
        });
      }
      tx.sql.run("insert into context_refs values (?, ?)", [
        reference.owner_key,
        BigInt(reference.registered_seq),
      ]);
      // 앞 callback의 mutation도 같은 command의 다음 callback에 반영하지 않는다.
      ctx.principal = "forged";
      ctx.actor = "machine";
      ctx.scope.operations.push("forged.operation");
      ctx.conditions.mode = "forged";
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.blob.hash,
        registered_seq: reference.registered_seq,
      });
    },
  };
}
