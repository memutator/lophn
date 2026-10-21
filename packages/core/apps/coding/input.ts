// harness 터미널에 메시지를 넣는다. 넣었다는 사실(MessageReceived)은 shell main의 결과가 ok일 때 낸다.
import type { Tx } from "../../../protocol/server/mod.ts";
import { sendTerminal } from "./events.ts";
import type { CodingMemory } from "./memory.ts";
import type { SessionRow } from "./store.ts";

// row를 바꾼다. 부른 쪽이 저장한다.
export function deliverInput(
  tx: Tx,
  memory: CodingMemory,
  row: SessionRow,
  call: string | null,
  text: string,
): void {
  row.inflight = true;
  const request = memory.request({
    kind: "input",
    session: row.session,
    text,
    call,
  });
  sendTerminal(tx, { kind: "input", request, session: row.session, text });
}
