// 도는 중에 보낸 메시지 줄(ACP `message_queued`)을 adapter들이 같이 쓰는 조각. 줄을 어디에 두는지(CLI, server, memory)와
// 줄을 CLI에 다시 넣는 길(`requeue`), 고친 메시지를 어디에 두는지는 harness마다 달라 각 adapter에 있다.
import type { AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";

/** `move_queued`: `id`를 이웃과 자리를 바꾼다. 바뀐 두 자리 중 앞 자리를 돌려주고, 옮길 수 없으면 null이다. */
export function swapQueued<T extends { id: string }>(
  list: T[],
  id: string,
  direction: "up" | "down",
): number | null {
  const index = list.findIndex((one) => one.id === id);
  const target = index + (direction === "up" ? -1 : 1);
  const moved = list[index];
  const other = list[target];
  if (moved === undefined || other === undefined) return null;
  list[index] = other;
  list[target] = moved;
  return Math.min(index, target);
}

/** memory에 둔 줄을 화면에 다시 낸다. 줄의 항목은 갱신을 받지 않아 모두 지우고 같은 id로 새 순서대로 다시 넣는다. */
export function resendQueue(
  queue: readonly { id: string; content: ContentBlock[] }[],
  publish: (update: AcpUpdate) => void,
  at: string,
): void {
  for (const one of queue)
    publish({ type: "message_removed", message: one.id });
  for (const one of queue)
    publish({
      type: "message_queued",
      queued: { id: one.id, at, content: one.content },
    });
}
