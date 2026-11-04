import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AcpItem,
  type AcpMessageItem,
  type AcpToolItem,
  type AcpUpdate,
  acpNoticeId,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../protocol/acp/mod.ts";
import { layoutOf } from "./thread-layout.ts";

const TURN = "trn_01h455vb4pex5v6nkc6gd5f001";
const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 6, 9, 0, second)).toISOString();

const USER = "msg_01h455vb4pex5v6nkc6gd5f001";
const ANSWER = "msg_01h455vb4pex5v6nkc6gd5f002";

function tool(
  n: number,
  second: number,
  category: AcpToolItem["category"],
  seq: number,
  over: Partial<AcpToolItem> = {},
): AcpToolItem {
  return {
    kind: "tool",
    id: `tcl_01h455vb4pex5v6nkc6gd5f00${n}`,
    seq,
    at: at(second),
    turn: TURN,
    tool: category === "command" ? "shell.run" : "file.read",
    category,
    title: `call ${n}`,
    state: "ok",
    duration_ms: 1000,
    detail: { kind: "generic" },
    ...over,
  };
}

const user: AcpMessageItem = {
  kind: "message",
  id: USER,
  seq: 1,
  at: at(0),
  actor: "user",
  sender: null,
  call: null,
  reply_to: null,
  delivery: "next_turn",
  turn: TURN,
  content: [{ type: "text", text: "Write the report." }],
  reasoning: null,
  cards: [],
  complete: true,
};
const answer: AcpMessageItem = {
  ...user,
  id: ANSWER,
  seq: 5,
  at: at(4),
  actor: "agent",
  content: [{ type: "text", text: "Done." }],
};
const edit = tool(4, 5, "other", 6, {
  tool: "file.edit",
  detail: {
    kind: "edit",
    document: "doc_01h455vb4pex5v6nkc6gd5f001",
    path: "report.md",
    added: 2,
    removed: 1,
  },
});

// turn이 끝나고 snapshot을 다시 읽어도 줄이 튀면 안 된다. 같은 기록을 갱신으로 접은 상태와 snapshot에서 만든
// 줄이 같아야 한다(옛 renderer는 시각으로 merge해서 turn이 끝난 뒤 줄 순서가 바뀌었다).
test("갱신을 접은 상태의 줄과 같은 기록 snapshot의 줄이 같다", () => {
  const read1 = tool(1, 1, "read", 2);
  const read2 = tool(2, 2, "read", 3);
  const run = tool(3, 3, "command", 4);

  const snapshot = {
    ...EMPTY_ACP_STATE,
    seq: 7,
    items: [
      user,
      read1,
      read2,
      run,
      answer,
      edit,
      {
        kind: "notice",
        id: acpNoticeId(TURN),
        seq: 7,
        at: at(6),
        turn: TURN,
        notice: {
          type: "turn_end",
          outcome: "completed",
          active_ms: 6000,
          waited_ms: 0,
        },
      },
    ] satisfies AcpItem[],
    turn: {
      id: TURN,
      phase: "ended" as const,
      started_at: at(0),
      elapsed: null,
    },
    dropped: { model_call: null, turn: TURN },
  };
  const started = (item: AcpToolItem): AcpUpdate => ({
    type: "tool_started",
    item: { ...item, state: "running", duration_ms: null },
  });
  const ended = (item: AcpToolItem, detail = item.detail): AcpUpdate => ({
    type: "tool_ended",
    tool_call: item.id,
    state: "ok",
    at: new Date(Date.parse(item.at) + 1000).toISOString(),
    detail: detail.kind === "generic" ? null : detail,
  });
  const updates: AcpUpdate[] = [
    { type: "turn_started", turn: TURN, at: at(0) },
    { type: "message_added", item: user },
    started(read1),
    ended(read1),
    started(read2),
    ended(read2),
    started(run),
    ended(run),
    {
      type: "message_recorded",
      turn: TURN,
      message: ANSWER,
      model_call: null,
      seq: 5,
      at: at(4),
      body: {
        content: [{ type: "text", text: "Done." }],
        reasoning: null,
        cards: [],
      },
    },
    started(edit),
    ended(edit),
    {
      type: "turn_ended",
      turn: TURN,
      at: at(6),
      outcome: "completed",
      active_ms: 6000,
      error: null,
      messages: [{ message: ANSWER, seq: 5 }],
      seq: 7,
    },
  ];
  const folded = updates.reduce(reduceAcp, EMPTY_ACP_STATE);
  assert.equal(folded.reread, false);
  assert.deepEqual(layoutOf(folded), layoutOf(snapshot));
});
