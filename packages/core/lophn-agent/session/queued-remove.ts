import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import { defineCommand, parseActor } from "../../../protocol/base/mod.ts";
import { MESSAGE_BODY_OWNER_KIND } from "../../../protocol/lophn-agent/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";

// 입력함에서 뺀 사람 메시지를 session 기록에서도 지운다. 아직 turn이 가져가지 않은 것만이다.
// 입력함은 메모리라 부르는 쪽(wiring)이 이 command를 먼저 부르고 성공하면 입력함에서 뺀다. core 안 machine만 쓴다.
export const messageRemoveQueued = defineCommand({
  resource: "messages",
  method: "remove_queued",
  name: "RemoveQueuedMessage",
  input: z.strictObject({
    session: idSchema("ses"),
    message: idSchema("msg"),
  }),
  output: z.strictObject({ message: idSchema("msg") }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict", "unavailable"],
});

export function removeQueuedCommand(deps: {
  eraseBlobRefs: (
    tx: Tx,
    ownerKind: string,
    ownerKeys: readonly string[],
  ) => Result<void>;
}): CommandDefinition<typeof messageRemoveQueued> {
  return {
    route: messageRemoveQueued,
    handle(tx, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({ code: "forbidden", message: "only core removes input" });
      }
      const row = tx.sql.get(
        "select from_kind, delivery, turn from messages where id = ? and session = ?",
        [input.message, input.session],
      );
      if (row === undefined) {
        return err({ code: "not_found", message: "message not found" });
      }
      if (
        row["from_kind"] !== "human" ||
        row["delivery"] !== "next_turn" ||
        row["turn"] !== null
      ) {
        return err({
          code: "conflict",
          message: "the turn already took this message",
        });
      }
      const erased = deps.eraseBlobRefs(tx, MESSAGE_BODY_OWNER_KIND, [
        input.message,
      ]);
      if (!erased.ok) return erased;
      tx.sql.run("delete from checkpoints where message = ?", [input.message]);
      tx.sql.run("delete from messages where id = ?", [input.message]);
      return ok({ message: input.message });
    },
  };
}
