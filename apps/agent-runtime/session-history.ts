import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  messageBody,
  messagesList,
  sessionRead,
  sessionSummary,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  SessionConversation,
  SessionMessage,
} from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 새 run의 prompt가 쓰는 session의 이전 대화다(lophn-agent/harness/prompt-assemble R3, R23). Compact한
// session이면 요약과 그것이 덮은 구간 뒤의 원문만 읽는다: 덮인 구간의 원문은 읽지도 않는다(원문은 session에
// 그대로 있고 화면도 그대로다). 이 run의 요청 메시지와 그 뒤에 접수된 메시지는 이전 대화가 아니다.
// 한 run 안에서는 Compact가 일어날 수 없어(끝나지 않은 run이 있으면 요청하지 않는다) 이 값은 run마다 한 번 읽는다.

const MAX_PAGES = 400;
const BODY_BATCH = 8;

export async function readSessionConversation(
  machine: CoreCall,
  input: {
    session: string | null;
    // 이 run의 요청 메시지. 없으면(session 없는 run, 다른 출처) 자른 곳이 없다.
    request: string | null;
  },
): Promise<Result<SessionConversation>> {
  if (input.session === null) return ok({ compaction: null, messages: [] });
  const session = await readOf(machine, sessionRead, {
    session: input.session,
  });
  if (!session.ok) return session;
  let compaction: SessionConversation["compaction"] = null;
  const covered = session.value.session.compaction;
  if (covered !== null) {
    const summary = await readOf(machine, sessionSummary, {
      session: input.session,
    });
    if (!summary.ok) return summary;
    compaction = {
      through_seq: BigInt(covered.through_seq),
      text: summary.value.text,
    };
  }

  const heard: { id: string; seq: bigint; role: "user" | "assistant" }[] = [];
  let cursor: string | undefined;
  for (let page = 0;; page++) {
    if (page >= MAX_PAGES) {
      return err({
        code: "unavailable",
        message: "the session is too long to read",
      });
    }
    const listed = await readOf(machine, messagesList, {
      session: input.session,
      ...(covered === null ? {} : { after_seq: covered.through_seq }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    let reached = false;
    for (const entry of listed.value.messages) {
      if (entry.message.id === input.request) {
        reached = true;
        break;
      }
      heard.push({
        id: entry.message.id,
        seq: BigInt(entry.created_seq),
        role: entry.message.actor === "user" ? "user" : "assistant",
      });
    }
    const next = listed.value.next_cursor;
    if (reached || next === null || next === undefined) break;
    cursor = next;
  }

  const messages: SessionMessage[] = [];
  for (let at = 0; at < heard.length; at += BODY_BATCH) {
    const batch = heard.slice(at, at + BODY_BATCH);
    const bodies = await Promise.all(
      batch.map((entry) => readOf(machine, messageBody, { message: entry.id })),
    );
    for (const [index, body] of bodies.entries()) {
      if (!body.ok) return body;
      const entry = batch[index]!;
      // 시각 블록뿐인 답은 글이 없어 이력에 넣지 않는다.
      const text = body.value.content.parts.flatMap((part) =>
        part.kind === "text" ? [part.text] : []
      ).join("\n");
      if (text.trim() === "") continue;
      messages.push({ seq: entry.seq, role: entry.role, text });
    }
  }
  return ok({ compaction, messages });
}
