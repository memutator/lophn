import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  editQueuedMessage,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
  serializeMessageContent,
} from "../../../protocol/lophn-agent/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";

// 아직 turn이 가져가지 않은 사람 메시지의 본문을 고친다. 입력함은 메모리라 부르는 쪽(wiring)이
// 이 command를 먼저 부르고 성공하면 입력함의 글도 바꾼다. core 안 machine만 쓴다.
// 본문 blob은 새 값으로 준비되어 있어야 하고, 참조는 같은 transaction에서 바꾼다.
export function editQueuedCommand(deps: {
  eraseBlobRefs: (
    tx: Tx,
    ownerKind: string,
    ownerKeys: readonly string[],
  ) => Result<void>;
}): CommandDefinition<typeof editQueuedMessage> {
  return {
    route: editQueuedMessage,
    handle(tx, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({ code: "forbidden", message: "only core edits input" });
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
      // preparer가 redaction한 값이다. 입력함도 이 값으로 바꿔야 다음 turn이 저장된 글과 같은 글을 본다.
      const text = input.content.parts.map((part) => part.text).join("\n");
      const bytes = serializeMessageContent(input.content);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const current = tx.sql.get(
        `select hash from blob_refs
         where owner_kind = ? and owner_key = ? and field = ?`,
        [MESSAGE_BODY_OWNER_KIND, input.message, MESSAGE_BODY_FIELD],
      );
      if (current?.["hash"] === hash) {
        return ok({ message: input.message, text });
      }
      const erased = deps.eraseBlobRefs(tx, MESSAGE_BODY_OWNER_KIND, [
        input.message,
      ]);
      if (!erased.ok) return erased;
      // 이 command는 event를 남기지 않으므로 지금까지의 마지막 seq를 참조 시각으로 쓴다.
      const head = tx.sql.get(
        "select coalesce(max(seq), 0) as seq from events",
        [],
      );
      const registered = tx.registerBlobRef({
        owner_kind: MESSAGE_BODY_OWNER_KIND,
        owner_key: input.message,
        field: MESSAGE_BODY_FIELD,
        registered_seq: String(head?.["seq"] ?? 0),
        source: {
          kind: "prepared",
          blob: {
            preparation: hash,
            principal: ctx.principal,
            purpose: MESSAGE_CONTENT_PURPOSE,
            hash,
            size_bytes: bytes.length,
          },
        },
      });
      if (!registered.ok) return registered;
      tx.sql.run("update messages set body = ? where id = ? and session = ?", [
        hash,
        input.message,
        input.session,
      ]);
      return ok({ message: input.message, text });
    },
  };
}
