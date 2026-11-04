import { err, ok, type Result } from "../../../base/mod.ts";
import {
  blocksOfContent,
  messageBody,
  placeSessionRead,
  type ReceivedMessage,
  receivedMessageList,
  rewindList,
  sessionSummary,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  SessionConversation,
  SessionMessage,
} from "../prompt-assembly/mod.ts";
import {
  type FoldedRange,
  foldsOf,
  type HiddenRange,
  hiddenRangesOf,
  inHiddenRange,
  type RevertRow,
} from "./rewind/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import {
  type ImageReader,
  loadParts,
  partsText,
  receivedParts,
} from "../run-loop/input-text.ts";

// 새 turn의 prompt가 쓰는 session의 이전 대화다. Compact한
// session이면 요약과 그것이 덮은 구간 뒤의 원문만 읽는다: 덮인 구간의 원문은 읽지도 않는다(원문은 session에
// 그대로 있고 화면도 그대로다). rewind가 숨긴 구간과 "Summarize from here"가 접은 구간의 원문도 읽지 않는다:
// 숨긴 구간은 입력에 들지 않고 접힌 구간은 그 요약이 맡는다. 숨김·접힘을 읽지 못하면 숨긴 내용이 새지 않게
// 대화 전체를 읽지 못한 것으로 한다. 이 turn의 요청 메시지와 아직 어느 turn도 가져가지 않은 메시지는 이전 대화가 아니다.
// 한 turn 안에서는 Compact가 일어날 수 없어(끝나지 않은 turn이 있으면 요청하지 않는다) 이 값은 turn마다 한 번 읽는다.

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
  for (let page = 0; ; page++) {
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
    // 이 turn의 요청 메시지. 없으면(session 없는 turn, 다른 출처) 자른 곳이 없다.
    request: string | null;
    // 받은 이미지의 bytes를 읽는 길. 없으면(Compact) 이미지는 고정 글로만 간다.
    images?: ImageReader;
  },
): Promise<Result<SessionConversation>> {
  if (input.session === null) return ok({ compaction: null, messages: [] });
  const session = await readOf(machine, placeSessionRead, {
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
    turn: string | null;
    received: ReceivedMessage;
  }[] = [];
  // 이 turn의 입력. 입력함은 사람 메시지를 먼저 꺼내므로 접수 순서와 turn 순서가 다르다.
  let requestTurn: string | null = null;
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      return err({
        code: "unavailable",
        message: "the session is too long to read",
      });
    }
    const listed = await readOf(machine, receivedMessageList, {
      session: input.session,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const entry of listed.value.messages) {
      if (entry.id === input.request) {
        requestTurn = entry.turn;
        continue;
      }
      // 요약이 덮은 구간과 숨긴 구간의 원문은 읽지도 않는다.
      if (
        covered !== null &&
        BigInt(entry.created_seq) <= BigInt(covered.through_seq)
      )
        continue;
      if (inHiddenRange(hidden, entry.created_seq)) continue;
      // 받은 메시지는 model에 들어간다. session이 자기 답으로 남긴 것은 model 자신의 말이라 assistant role이다.
      heard.push({
        id: entry.id,
        seq: BigInt(entry.created_seq),
        role:
          entry.from.kind === "agent" && entry.from.session === input.session
            ? "assistant"
            : "user",
        folded: folds.some(
          (fold) =>
            BigInt(entry.created_seq) >= BigInt(fold.from_seq) &&
            BigInt(entry.created_seq) <= BigInt(fold.through_seq),
        ),
        turn: entry.turn,
        received: entry,
      });
    }
    const next = listed.value.next_cursor;
    if (next === null || next === undefined) break;
    cursor = next;
  }
  // turn의 prompt는 앞 turn들이 가져간 메시지(turn 순서대로)와 이 turn의 입력이다. 아직 어느 turn도 가져가지
  // 않은 메시지는 어떤 turn의 prompt에도 들어가지 않는다. 요청이 없는 읽기(Compact)는 모든 메시지를 접수 순서로 본다.
  const taken =
    input.request === null
      ? heard
      : heard
          .filter((entry) => entry.turn !== null && entry.turn !== requestTurn)
          .sort((a, b) =>
            a.turn! === b.turn!
              ? a.seq < b.seq
                ? -1
                : 1
              : a.turn! < b.turn!
                ? -1
                : 1,
          );

  const built: { turn: string | null; message: SessionMessage }[] = [];
  for (let at = 0; at < taken.length; at += BODY_BATCH) {
    const batch = taken.slice(at, at + BODY_BATCH);
    const bodies = await Promise.all(
      batch.map((entry) =>
        entry.folded
          ? Promise.resolve(ok(null))
          : readOf(machine, messageBody, { message: entry.id }),
      ),
    );
    for (const [index, body] of bodies.entries()) {
      if (!body.ok) return body;
      const entry = batch[index]!;
      if (body.value === null) {
        built.push({
          turn: entry.turn,
          message: { seq: entry.seq, role: entry.role, text: "" },
        });
        continue;
      }
      const blocks = blocksOfContent(body.value.content);
      // 카드뿐인 답은 글이 없어 이력에 넣지 않는다. 글 없는 취소 알림은 tag만으로 뜻이 있다.
      if (entry.role === "assistant") {
        const text = blocks
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        if (text.trim() !== "") {
          built.push({
            turn: entry.turn,
            message: { seq: entry.seq, role: "assistant", text },
          });
        }
        continue;
      }
      // 받은 turn의 입력과 같은 part 함수로 싼다. 이미지가 있으면 같은 bytes를 붙여 part를 그대로 둔다.
      const parts = receivedParts(entry.received, blocks);
      const text = partsText(parts);
      if (text.trim() === "" && entry.received.from.kind === "human") continue;
      const withImage = parts.some((part) => part.kind === "image");
      built.push({
        turn: entry.turn,
        message: {
          seq: entry.seq,
          role: entry.role,
          text,
          ...(withImage && input.images !== undefined
            ? { parts: await loadParts(parts, input.images) }
            : {}),
        },
      });
    }
  }
  const messages = built.map((b) => b.message);
  return ok({
    compaction,
    // 되돌린 적이 없는 session은 이 두 칸을 두지 않는다.
    ...(hidden.length === 0
      ? {}
      : {
          hidden: hidden.map((range) => ({
            from_seq: BigInt(range.from_seq),
            through_seq: BigInt(range.through_seq),
          })),
        }),
    ...(folds.length === 0
      ? {}
      : {
          folds: folds.map((fold) => ({
            from_seq: BigInt(fold.from_seq),
            through_seq: BigInt(fold.through_seq),
            text: fold.text,
          })),
        }),
    messages,
  });
}
