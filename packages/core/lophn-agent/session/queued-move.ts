import { err, ok } from "../../../base/mod.ts";
import { moveQueuedMessage } from "../../../protocol/lophn-agent/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";

// 아직 turn이 가져가지 않은 사람 메시지를 큐에서 위아래로 옮긴다. 입력함은 메모리라 부르는 쪽이
// 이 command를 먼저 부르고 성공하면 입력함의 순서도 바꾼다. 표의 created_seq를 이웃과 맞바꾸므로
// 켤 때 입력함에 다시 넣는 순서와 대화 기록의 순서가 같은 순서가 된다. core 안 machine만 쓴다.
export function moveQueuedCommand(): CommandDefinition<
  typeof moveQueuedMessage
> {
  return {
    route: moveQueuedMessage,
    handle(tx, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({ code: "forbidden", message: "only core moves input" });
      }
      const row = tx.sql.get(
        "select from_kind, delivery, turn, created_seq from messages where id = ? and session = ?",
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
      const created = Number(row["created_seq"]);
      const neighbor = tx.sql.get(
        `select id, created_seq from messages
         where session = ? and from_kind = 'human' and delivery = 'next_turn'
           and turn is null and created_seq ${input.direction === "up" ? "<" : ">"} ?
         order by created_seq ${input.direction === "up" ? "desc" : "asc"}
         limit 1`,
        [input.session, created],
      );
      if (neighbor === undefined) return ok({ message: input.message });
      const other = Number(neighbor["created_seq"]);
      // created_seq는 unique라 두 행을 바로 맞바꿀 수 없다. 비어 있는 다음 번호를 잠시 쓴다.
      const head = tx.sql.get(
        "select coalesce(max(created_seq), 0) + 1 as next from messages",
        [],
      );
      setSeq(tx, input.message, Number(head?.["next"] ?? 1));
      setSeq(tx, String(neighbor["id"]), created);
      setSeq(tx, input.message, other);
      return ok({ message: input.message });
    },
  };
}

// state_seq는 만든 때 created_seq와 같다. 둘을 함께 옮겨 state_seq >= created_seq를 지킨다.
function setSeq(tx: Tx, message: string, seq: number): void {
  tx.sql.run(
    "update messages set created_seq = ?, state_seq = ? where id = ?",
    [seq, seq, message],
  );
}
