import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  messageBody,
  messagesList,
  rewindList,
  sessionRead,
  sessionSummary,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type {
  SessionConversation,
  SessionMessage,
} from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import {
  type FoldedRange,
  foldsOf,
  type HiddenRange,
  hiddenRangesOf,
  inHiddenRange,
  type RevertRow,
} from "../../packages/lophn-agent/revert/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 새 run의 prompt가 쓰는 session의 이전 대화다(lophn-agent/harness/prompt-assemble R3, R23, R31). Compact한
// session이면 요약과 그것이 덮은 구간 뒤의 원문만 읽는다: 덮인 구간의 원문은 읽지도 않는다(원문은 session에
// 그대로 있고 화면도 그대로다). rewind가 숨긴 구간과 "Summarize from here"가 접은 구간의 원문도 읽지 않는다:
// 숨긴 구간은 입력에 들지 않고 접힌 구간은 그 요약이 맡는다. 숨김·접힘을 읽지 못하면 숨긴 내용이 새지 않게
// 대화 전체를 읽지 못한 것으로 한다. 이 run의 요청 메시지와 그 뒤에 접수된 메시지는 이전 대화가 아니다.
// 한 run 안에서는 Compact가 일어날 수 없어(끝나지 않은 run이 있으면 요청하지 않는다) 이 값은 run마다 한 번 읽는다.

const MAX_PAGES = 400;
const BODY_BATCH = 8;

// session의 되돌리기 기록에서 숨김 구간과 접힘 구간(과 그 요약 본문)을 읽는다.
async function readRewound(
  machine: CoreCall,
  session: string,
): Promise<
  Result<{ hidden: HiddenRange[]; folds: (FoldedRange & { text: string })[] }>
> {
  const rows: RevertRow[] = [];
  let cursor: string | undefined;
  for (let page = 0;; page++) {
    if (page >= MAX_PAGES) {
      return err({
        code: "unavailable",
        message: "the session has too many rewinds to read",
      });
    }
    const listed = await readOf(machine, rewindList, {
      session,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    rows.push(...listed.value.reverts);
    const next = listed.value.next_cursor;
    if (next === null || next === undefined) break;
    cursor = next;
  }
  const folds: (FoldedRange & { text: string })[] = [];
  for (const fold of foldsOf(rows)) {
    const summary = await readOf(machine, sessionSummary, {
      session,
      revert: fold.revert,
    });
    if (!summary.ok) return summary;
    folds.push({ ...fold, text: summary.value.text });
  }
  return ok({ hidden: hiddenRangesOf(rows), folds });
}

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
  const rewound = await readRewound(machine, input.session);
  if (!rewound.ok) return rewound;
  const { hidden, folds } = rewound.value;
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

  const heard: {
    id: string;
    seq: bigint;
    role: "user" | "assistant";
    // 접힌 구간의 메시지는 요약이 맡으므로 본문을 읽지 않는다. 구간의 자리를 알리는 표시로만 둔다.
    folded: boolean;
  }[] = [];
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
      // 숨긴 구간의 원문은 읽지도 않는다.
      if (inHiddenRange(hidden, entry.created_seq)) continue;
      heard.push({
        id: entry.message.id,
        seq: BigInt(entry.created_seq),
        role: entry.message.actor === "user" ? "user" : "assistant",
        folded: folds.some((fold) =>
          BigInt(entry.created_seq) >= BigInt(fold.from_seq) &&
          BigInt(entry.created_seq) <= BigInt(fold.through_seq)
        ),
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
      batch.map((entry) =>
        entry.folded
          ? Promise.resolve(ok(null))
          : readOf(machine, messageBody, { message: entry.id })
      ),
    );
    for (const [index, body] of bodies.entries()) {
      if (!body.ok) return body;
      const entry = batch[index]!;
      if (body.value === null) {
        messages.push({ seq: entry.seq, role: entry.role, text: "" });
        continue;
      }
      // 시각 블록뿐인 답은 글이 없어 이력에 넣지 않는다.
      const text = body.value.content.parts.flatMap((part) =>
        part.kind === "text" ? [part.text] : []
      ).join("\n");
      if (text.trim() === "") continue;
      messages.push({ seq: entry.seq, role: entry.role, text });
    }
  }
  return ok({
    compaction,
    // 되돌린 적이 없는 session은 이 두 칸을 두지 않는다.
    ...(hidden.length === 0 ? {} : {
      hidden: hidden.map((range) => ({
        from_seq: BigInt(range.from_seq),
        through_seq: BigInt(range.through_seq),
      })),
    }),
    ...(folds.length === 0 ? {} : {
      folds: folds.map((fold) => ({
        from_seq: BigInt(fold.from_seq),
        through_seq: BigInt(fold.through_seq),
        text: fold.text,
      })),
    }),
    messages,
  });
}
