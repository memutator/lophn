import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type Checkpoint,
  checkpointSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { CallFrom } from "../../../../protocol/lophn-agent/calls.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";

// Checkpoint는 turn을 시작하는 Router 입력(사람 메시지, call, 답)마다 생긴다. 메시지를 접수하는 같은
// transaction이 만든다. steer로 도는 turn에 들어간 메시지와 Fork 복사본(`copied_from`이 있는 메시지)은
// checkpoint가 아니다.

type CheckpointMessage = {
  id: string;
  session: string;
  from_kind: CallFrom["kind"];
  // 사람 메시지가 아니면 null이다.
  delivery: "next_turn" | "steer" | null;
  copied_from: string | null;
};

// checkpoint가 아닌 메시지면 ok(null)이다. 같은 메시지로 다시 불러도 한 행이고, 이미 낮아진 칸은
// 건드리지 않는다.
export function createCheckpoint(
  tx: Tx,
  message: CheckpointMessage,
): Result<Checkpoint | null> {
  if (message.delivery === "steer" || message.copied_from !== null) {
    return ok(null);
  }
  tx.sql.run(
    "insert or ignore into checkpoints (message, session) values (?, ?)",
    [message.id, message.session],
  );
  const row = tx.sql.get(
    `select message, session, files_restorable, files_reason
       from checkpoints where message = ?`,
    [message.id],
  );
  if (row === undefined) {
    return err({ code: "internal", message: "checkpoint was not stored" });
  }
  return ok(
    checkpointSchema.parse({
      message: String(row["message"]),
      session: String(row["session"]),
      files_restorable: Number(row["files_restorable"]) === 1,
      files_reason:
        row["files_reason"] === null ? null : String(row["files_reason"]),
    }),
  );
}
