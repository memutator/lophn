import { ok, type Result } from "../../../../base/mod.ts";
import {
  messageBody,
  receivedMessageList,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Output } from "../../../../protocol/server/mod.ts";

// 각 wiring가 자기 machine 자격으로 묶은 read다.
type Read = <T>(
  r: { resource: string; method: string },
  input: unknown,
) => Promise<Result<T>>;

// 그 turn에서 그 session의 agent가 RecordMessage로 남긴 마지막 메시지의 글. 없으면 null이다.
export async function turnAnswer(
  read: Read,
  session: string,
  turn: string,
): Promise<Result<string | null>> {
  let last: string | null = null;
  let cursor: string | undefined;
  for (;;) {
    const page = await read<Output<typeof receivedMessageList>>(
      receivedMessageList,
      { session, turn, ...(cursor === undefined ? {} : { cursor }) },
    );
    if (!page.ok) return page;
    for (const m of page.value.messages) {
      if (m.from.kind === "agent" && m.from.session === session) {
        last = m.id;
      }
    }
    const next = page.value.next_cursor;
    if (next === null || next === undefined) break;
    cursor = next;
  }
  if (last === null) return ok(null);
  const body = await read<Output<typeof messageBody>>(messageBody, {
    message: last,
  });
  if (!body.ok) return body;
  const text = body.value.content.parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n");
  // 옛 turn은 글이 빈 마지막 응답도 message로 남겼다. 그때는 답이 없는 것으로 본다.
  return ok(text.trim() === "" ? null : text);
}
