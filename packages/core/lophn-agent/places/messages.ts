import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
  contentOfBlocks,
  serializeMessageContent,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { RoutedInput } from "../../router/ports.ts";
import { createCheckpoint } from "../session/rewind/mod.ts";
import { registerImageRefs } from "../session/message-images.ts";
import { loadSession, nextMessageSeq } from "../session/model.ts";

// call, reply, reaction, notice, step을 받는 session 기록(messages 행)에 쓴다. lophn InputTransport가 배달하는
// tx에서 부른다. 사람 메시지는 보내는 쪽이 먼저 쓰므로 `message`가 있으면 그 id를 돌려줄 뿐이다.
// 본문 blob과 image block의 blob은 호출한 자격의 이름으로 준비돼 있어야 한다.
export function createReceivedRecorder(deps: { principal(): string }) {
  return {
    record(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<Id<"msg">> {
      if (input.message !== null) return ok(input.message);
      const row = loadSession(tx, session);
      if (row === undefined) {
        return err({ code: "not_found", message: "session not found" });
      }
      if (row.lifecycle !== "open") {
        return err({ code: "conflict", message: "the session is archived" });
      }
      const bytes = serializeMessageContent(contentOfBlocks(input.body));
      const hash = createHash("sha256").update(bytes).digest("hex");
      const id = tx.newId("msg") as Id<"msg">;
      const seq = nextMessageSeq(tx);
      const from = input.from;
      tx.sql.run(
        `insert into messages (id, session, from_kind, from_ref, call,
           reply_to, refs, reply, event, fail_reason, delivery, step_instance, step_name, turn, body,
           created_seq, created_at, state_seq)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?)`,
        [
          id,
          session,
          from.kind,
          from.kind === "human" || from.kind === "program"
            ? null
            : from.session,
          input.call,
          input.reply_to,
          JSON.stringify(input.refs),
          input.kind === "call" ? input.reply : null,
          input.kind === "reaction" ? input.event : null,
          input.outcome?.reason ?? null,
          from.kind === "human" ? input.delivery : "next_turn",
          input.step?.instance ?? null,
          input.step?.step ?? null,
          hash,
          seq,
          tx.now(),
          seq,
        ],
      );
      const registered = tx.registerBlobRef({
        owner_kind: MESSAGE_BODY_OWNER_KIND,
        owner_key: id,
        field: MESSAGE_BODY_FIELD,
        registered_seq: String(seq),
        source: {
          kind: "prepared",
          blob: {
            preparation: hash,
            principal: deps.principal(),
            purpose: MESSAGE_CONTENT_PURPOSE,
            hash,
            size_bytes: bytes.length,
          },
        },
      });
      if (!registered.ok) return registered;
      const images = registerImageRefs(
        tx,
        id,
        String(seq),
        deps.principal(),
        input.body,
      );
      if (!images.ok) return images;
      // turn을 시작하는 call, 답, step도 rewind로 돌아갈 시점이다.
      if (
        input.kind === "call" ||
        input.kind === "reply" ||
        input.kind === "step"
      ) {
        const checkpoint = createCheckpoint(tx, {
          id,
          session,
          from_kind: from.kind,
          delivery: null,
          copied_from: null,
        });
        if (!checkpoint.ok) return checkpoint;
      }
      return ok(id);
    },
  };
}
