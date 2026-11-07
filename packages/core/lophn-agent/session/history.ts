import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentRuntime,
  blocksOfContent,
  messageBody,
  type ReceivedMessage,
  receivedMessageList,
  rewindList,
  sessionSummary,
  turnBody,
  turnList,
  workspaceSessionRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type HistoryMessage,
  historyMessageText,
  type SessionConversation,
  type SessionMessage,
} from "../prompt-assembly/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import {
  type ImageReader,
  loadParts,
  partsText,
  receivedParts,
  shellParts,
} from "../run-loop/input-text.ts";
import {
  type FoldedRange,
  foldsOf,
  type HiddenRange,
  hiddenRangesOf,
  inHiddenRange,
  type RevertRow,
} from "./rewind/mod.ts";

// 새 turn의 prompt가 쓰는 session의 이전 대화다. Compact한
// session이면 요약과 그것이 덮은 구간 뒤의 원문만 읽는다: 덮인 구간의 원문은 읽지도 않는다(원문은 session에
// 그대로 있고 화면도 그대로다). rewind가 숨긴 구간과 "Summarize from here"가 접은 구간의 원문도 읽지 않는다:
// 숨긴 구간은 입력에 들지 않고 접힌 구간은 그 요약이 맡는다. 숨김·접힘을 읽지 못하면 숨긴 내용이 새지 않게
// 대화 전체를 읽지 못한 것으로 한다. 이 turn의 요청 메시지와 아직 어느 turn도 가져가지 않은 메시지는 이전 대화가 아니다.
// 앞 turn이 turn 안 이력(tool 호출과 결과, 그 사이 답과 steering)을 남겼으면 그 turn의 요청 뒤에 그 이력을 그대로
// 잇고, 이력이 맡은 그 turn의 답·steering 메시지는 따로 넣지 않는다. 그 turn이 model에 보낸 이력과 같은 바이트라
// 다음 turn이 앞 turn의 prompt cache를 읽는다. 이력이 없는 turn(옛 turn, 남기지 못한 turn)은 메시지로만 읽는다.
// turn 안 Compact가 아니면 turn이 도는 동안 Compact가 일어나지 않아 이 값은 turn마다 한 번 읽는다. turn 안 Compact 뒤에는 turn이 session 대화를 다시 읽는다.

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

// 앞 turn들이 남긴 turn 안 이력과 그 turn의 요청 메시지. 이력이 없거나 읽지 못한 turn은 넣지 않는다(메시지로만 읽는다).
async function turnHistories(
  machine: CoreCall,
  session: string,
  wanted: readonly string[],
): Promise<
  Result<Map<string, { request: string; messages: HistoryMessage[] }>>
> {
  const out = new Map<
    string,
    { request: string; messages: HistoryMessage[] }
  >();
  const turns = new Set(wanted);
  if (turns.size === 0) return ok(out);
  const requests = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      return err({
        code: "unavailable",
        message: "the session has too many turns to read",
      });
    }
    const listed = await readOf(machine, turnList, {
      session,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const turn of listed.value.turns) {
      if (turns.has(turn.id)) requests.set(turn.id, turn.input_message);
    }
    const next = listed.value.next_cursor;
    if (next === null || next === undefined) break;
    cursor = next;
  }
  for (const [turn, request] of requests) {
    const body = await readOf(machine, turnBody, {
      kind: "turn_history",
      id: turn,
    });
    if (!body.ok) {
      if (body.error.code === "not_found") continue;
      return body;
    }
    const messages = historyMessages(body.value.value);
    if (messages !== null) out.set(turn, { request, messages });
  }
  return ok(out);
}

function historyMessages(value: unknown): HistoryMessage[] | null {
  if (!Array.isArray(value)) return null;
  const ok = value.every(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message.role === "user" || message.role === "assistant") &&
      Array.isArray(message.parts),
  );
  return ok ? (value as HistoryMessage[]) : null;
}

export async function readSessionConversation(
  machine: CoreCall,
  input: {
    session: string | null;
    // 이 turn의 요청 메시지. 없으면(session 없는 turn, 다른 출처) 자른 곳이 없다.
    request: string | null;
    // 받은 이미지의 bytes를 읽는 길. 없으면(Compact) 이미지는 고정 글로만 간다.
    images?: ImageReader;
    // 받은 call 글이 runtime마다 다르다. 없으면 lophn이다.
    runtime?: AgentRuntime;
    // turn 안 Compact를 하는 도는 turn. 그 turn의 진행은 따로 받으므로 남긴 이력을 읽지 않는다.
    running?: string;
  },
): Promise<Result<SessionConversation>> {
  if (input.session === null) return ok({ compaction: null, messages: [] });
  const session = await readOf(machine, workspaceSessionRead, {
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
  // 이 turn의 입력. queue는 사람 메시지를 먼저 꺼내므로 접수 순서와 turn 순서가 다르다.
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
          // `!` 명령의 기록은 이 turn이 가져간 것도 요청 앞에 들어간다.
          .filter(
            (entry) =>
              entry.turn !== null &&
              (entry.turn !== requestTurn || entry.received.shell),
          )
          .sort((a, b) =>
            a.turn! === b.turn!
              ? a.seq < b.seq
                ? -1
                : 1
              : a.turn! < b.turn!
                ? -1
                : 1,
          );

  const histories = await turnHistories(
    machine,
    input.session,
    taken.flatMap((entry) =>
      entry.turn === null ||
      entry.turn === requestTurn ||
      entry.turn === input.running
        ? []
        : [entry.turn],
    ),
  );
  if (!histories.ok) return histories;
  // 이력은 그 turn의 마지막 메시지 자리(seq)에 놓인다. Compact·숨김·접힘이 그 turn의 끝과 같이 덮는다.
  const lastSeq = new Map<string, bigint>();
  for (const entry of heard) {
    if (entry.turn === null) continue;
    const seen = lastSeq.get(entry.turn);
    if (seen === undefined || entry.seq > seen)
      lastSeq.set(entry.turn, entry.seq);
  }
  const kept = taken.filter((entry) => {
    const history =
      entry.turn === null ? undefined : histories.value.get(entry.turn);
    return (
      history === undefined ||
      entry.id === history.request ||
      entry.received.shell
    );
  });

  const built: { turn: string | null; message: SessionMessage }[] = [];
  const replay = (entry: (typeof taken)[number]) => {
    const history =
      entry.turn === null ? undefined : histories.value.get(entry.turn);
    if (history === undefined || entry.id !== history.request) return;
    const seq = lastSeq.get(entry.turn!) ?? entry.seq;
    const names = new Map<string, string>();
    for (const message of history.messages) {
      for (const part of message.parts) {
        if (part.kind === "tool_use") names.set(part.id, part.name);
      }
    }
    for (const message of history.messages) {
      built.push({
        turn: entry.turn,
        message: {
          seq,
          role: message.role,
          text: historyMessageText(message, names),
          parts: message.parts,
          tool: true,
        },
      });
    }
  };
  // 받은 메시지 하나를 이전 대화의 message로 만든다. 접힌 메시지는 본문 없이 자리만 둔다.
  const push = async (
    entry: (typeof taken)[number],
    body: { content: Parameters<typeof blocksOfContent>[0] } | null,
  ): Promise<void> => {
    if (body === null) {
      built.push({
        turn: entry.turn,
        message: { seq: entry.seq, role: entry.role, text: "" },
      });
      return;
    }
    const shell = entry.received.shell
      ? body.content.parts.find((part) => part.kind === "shell")
      : undefined;
    if (shell !== undefined) {
      built.push({
        turn: entry.turn,
        message: {
          seq: entry.seq,
          role: "user",
          text: partsText(shellParts(shell)),
        },
      });
      return;
    }
    const blocks = blocksOfContent(body.content);
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
      return;
    }
    // 받은 turn의 입력과 같은 part 함수로 싼다. 이미지가 있으면 같은 bytes를 붙여 part를 그대로 둔다.
    const parts = receivedParts(entry.received, blocks, input.runtime);
    const text = partsText(parts);
    if (text.trim() === "" && entry.received.from.kind === "human") return;
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
  };
  for (let at = 0; at < kept.length; at += BODY_BATCH) {
    const batch = kept.slice(at, at + BODY_BATCH);
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
      await push(entry, body.value);
      replay(entry);
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
