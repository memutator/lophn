import type { Result } from "../../base/mod.ts";
import type { Checkpoint } from "../../contracts/lophn-agent/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";

// Checkpoint는 run을 시작하는 사람 메시지(`mode=request`) 하나다(lophn-agent/revert). ReceiveMessage가
// 메시지를 접수하는 같은 transaction에서 만든다. correction·agent·machine 메시지와 Fork 복사본
// (`copied_from`이 있는 메시지)은 checkpoint가 아니다. 구현은 agent-RW3a가 채운다.

export type CheckpointMessage = {
  id: string;
  session: string;
  actor: string;
  mode: "request" | "correction" | null;
  copied_from: string | null;
};

// checkpoint가 아닌 메시지면 ok(null)이다. 같은 메시지로 다시 불러도 한 행이다.
export function createCheckpoint(
  tx: Tx,
  message: CheckpointMessage,
): Result<Checkpoint | null> {
  void tx;
  void message;
  throw new Error("not implemented: agent-RW3a");
}
