import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentEvent } from "../events/agent.ts";
import {
  type AcpContext,
  type AcpItem,
  type AcpState,
  type AcpUpdate,
  acpStateSchema,
  acpUpdatesOf,
  acpUpdateSchema,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "./mod.ts";

const AT = "2026-10-26T09:00:00.000Z";
const TURN = "trn_01h455vb4pex5v6nkc6gd5f001";
const CALL_1 = "mcl_01h455vb4pex5v6nkc6gd5f001";
const CALL_2 = "mcl_01h455vb4pex5v6nkc6gd5f002";

function streamed(
  modelCall: string,
  kind: "text" | "reasoning",
  offset: number,
  text: string,
): AcpUpdate {
  return {
    type: "writing_streamed",
    turn: TURN,
    model_call: modelCall,
    kind,
    offset,
    text,
    at: AT,
  };
}

function writingOf(state: AcpState) {
  return {
    text: state.writing?.text,
    reasoning: state.writing?.reasoning,
    modelCall: state.writing?.model_call,
    reread: state.reread,
  };
}

// 흘러나온 글이 화면에 남는 모양을 정한다: 겹친 조각은 두 번 붙지 않고, 다른 model 호출(retry)의 조각이면
// 앞 attempt의 글을 버리고, offset이 앞 글을 넘으면 붙이지 않고 다시 읽게 한다.
test("흘러나온 글은 retry된 attempt를 버리고 겹친 조각을 두 번 붙이지 않으며 offset이 비면 다시 읽게 한다", () => {
  const rows: readonly {
    readonly name: string;
    readonly update: AcpUpdate;
    readonly expected: ReturnType<typeof writingOf>;
  }[] = [
    {
      name: "snapshot 뒤의 조각은 앞 글에 이어진다",
      update: streamed(CALL_1, "text", 3, "lo"),
      expected: {
        text: "Hello",
        reasoning: "",
        modelCall: CALL_1,
        reread: false,
      },
    },
    {
      name: "이미 가진 글과 겹치는 조각은 두 번 붙지 않는다",
      update: streamed(CALL_1, "text", 0, "Hello"),
      expected: {
        text: "Hello",
        reasoning: "",
        modelCall: CALL_1,
        reread: false,
      },
    },
    {
      name: "반쯤 겹치는 조각은 겹치지 않은 부분만 붙는다",
      update: streamed(CALL_1, "text", 4, "o wor"),
      expected: {
        text: "Hello wor",
        reasoning: "",
        modelCall: CALL_1,
        reread: false,
      },
    },
    {
      name: "다른 model 호출(retry)의 조각이면 앞 attempt의 글은 남지 않는다",
      update: streamed(CALL_2, "text", 0, "Hi"),
      expected: { text: "Hi", reasoning: "", modelCall: CALL_2, reread: false },
    },
    {
      name: "앞 글 길이를 넘는 offset은 붙이지 않고 다시 읽게 한다",
      update: streamed(CALL_2, "text", 5, "x"),
      expected: { text: "Hi", reasoning: "", modelCall: CALL_2, reread: true },
    },
    {
      name: "reasoning은 text와 따로 센다",
      update: streamed(CALL_2, "reasoning", 0, "plan"),
      expected: {
        text: "Hi",
        reasoning: "plan",
        modelCall: CALL_2,
        reread: true,
      },
    },
  ];

  let state: AcpState = {
    ...EMPTY_ACP_STATE,
    writing: {
      turn: TURN,
      model_call: CALL_1,
      text: "Hel",
      reasoning: "",
      at: AT,
    },
  };
  for (const row of rows) {
    state = reduceAcp(state, row.update);
    assert.deepStrictEqual(writingOf(state), row.expected, row.name);
  }
});

// 같은 event 흐름을 갱신으로 바꿔 접는다. 갱신마다 한 번 더 접어도 같은 상태이고(snapshot과 stream이 겹쳐도
// 항목이 두 번 들지 않는다), 항목은 순번 순서이며 줄에 선 메시지는 steer될 때 순번을 받는다.
test("갱신은 두 번 접어도 같고 항목은 순번 순서이며 순번이 빠지면 다시 읽게 한다", () => {
  const seqs = new Map([
    ["msg_01h455vb4pex5v6nkc6gd5f001", 1],
    ["msg_01h455vb4pex5v6nkc6gd5f002", 2],
    ["tcl_01h455vb4pex5v6nkc6gd5f001", 3],
    ["apr_01h455vb4pex5v6nkc6gd5f001", 4],
    ["msg_01h455vb4pex5v6nkc6gd5f003", 5],
    ["end-" + TURN, 6],
  ]);
  const queuedId = "msg_01h455vb4pex5v6nkc6gd5f003";
  const steered = new Set<string>();
  const context: AcpContext = {
    // 줄에 선 메시지는 steer되기 전까지 대화에 들지 않았다.
    seq: (id) =>
      id === queuedId && !steered.has(id) ? null : (seqs.get(id) ?? null),
    tool: () => ({
      kind: "edit",
      document: "doc_01h455vb4pex5v6nkc6gd5f001",
      path: "a.md",
      added: 2,
      removed: 1,
    }),
    questions: () => null,
    agentOf: () => null,
    decision: () => ({ choice: "once", reason: null }),
  };
  const at = (n: number) => `2026-10-26T09:00:0${n}.000Z`;
  const events = [
    {
      type: "MessageReceived",
      at: at(0),
      payload: {
        message: "msg_01h455vb4pex5v6nkc6gd5f001",
        body: "go",
        from: { kind: "human" },
        call: null,
        reply_to: null,
        steer: false,
      },
    },
    {
      type: "TurnStarted",
      at: at(0),
      payload: { turn: TURN, input_message: "msg_01h455vb4pex5v6nkc6gd5f001" },
    },
    {
      type: "MessageReceived",
      at: at(1),
      payload: {
        message: queuedId,
        body: "also",
        from: { kind: "human" },
        call: null,
        reply_to: null,
        steer: false,
      },
    },
    {
      type: "ModelOutputStreamed",
      at: at(1),
      payload: {
        turn: TURN,
        model_call: CALL_1,
        kind: "text",
        offset: 0,
        text: "Hi",
      },
    },
    {
      type: "MessageRecorded",
      at: at(2),
      payload: {
        turn: TURN,
        message: "msg_01h455vb4pex5v6nkc6gd5f002",
        model_call: CALL_1,
      },
    },
    {
      type: "ToolCallStarted",
      at: at(2),
      payload: {
        turn: TURN,
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5f001",
        tool: "file.edit",
        display: { category: "other", title: "Edit a.md" },
      },
    },
    {
      type: "ToolCallEnded",
      at: at(4),
      payload: {
        turn: TURN,
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5f001",
        outcome: "ok",
      },
    },
    {
      type: "TurnRequestOpened",
      at: at(4),
      payload: {
        request: {
          id: "apr_01h455vb4pex5v6nkc6gd5f001",
          session: "ses_01h455vb4pex5v6nkc6gd5f001",
          turn: TURN,
          tool_call: "tcl_01h455vb4pex5v6nkc6gd5f002",
          subject: { kind: "shell", command: "ls" },
          always_patterns: [],
          created_at: at(4),
        },
      },
    },
    {
      type: "TurnRequestClosed",
      at: at(5),
      payload: { request: "apr_01h455vb4pex5v6nkc6gd5f001", outcome: "allow" },
    },
    {
      type: "MessageSteered",
      at: at(5),
      payload: { message: queuedId },
    },
    {
      type: "TurnEnded",
      at: at(6),
      payload: {
        turn: TURN,
        outcome: { kind: "completed", reason: "final_answer" },
        messages: [],
        active_ms: 5000,
        error: null,
      },
    },
  ] as unknown as AgentEvent[];

  let once: AcpState = EMPTY_ACP_STATE;
  for (const event of events) {
    if (event.type === "MessageSteered") steered.add(event.payload.message);
    for (const update of acpUpdatesOf(event, context)) {
      acpUpdateSchema.parse(update);
      once = reduceAcp(once, update);
      assert.deepStrictEqual(reduceAcp(once, update), once, update.type);
    }
  }

  acpStateSchema.parse(once);
  const summary = (item: AcpItem) => `${item.seq}:${item.kind}`;
  assert.deepStrictEqual(once.items.map(summary), [
    "1:message",
    "2:message",
    "3:tool",
    "4:approval",
    "5:message",
    "6:notice",
  ]);
  assert.deepStrictEqual(once.queued, []);
  assert.equal(once.turn?.phase, "ended");
  const recorded = once.items[1];
  assert.deepStrictEqual(recorded?.kind === "message" && recorded.content, [
    { type: "text", text: "Hi" },
  ]);
  const tool = once.items[2];
  assert.deepStrictEqual(
    tool?.kind === "tool" && [tool.state, tool.duration_ms, tool.detail.kind],
    ["ok", 2000, "edit"],
  );
  // 저장된 agent message의 최종 본문은 stream이 싣지 않아 turn이 끝나면 다시 읽는다.
  assert.equal(once.reread, true);

  // 순번을 건너뛴 항목이 오면 snapshot을 다시 읽으라는 표시가 선다.
  const skipped = reduceAcp(EMPTY_ACP_STATE, {
    type: "message_added",
    item: {
      kind: "message",
      id: "msg_01h455vb4pex5v6nkc6gd5f009",
      seq: 3,
      at: AT,
      actor: "user",
      sender: null,
      call: null,
      reply_to: null,
      delivery: "next_turn",
      turn: null,
      content: [{ type: "text", text: "hi" }],
      reasoning: null,
      complete: true,
    },
  });
  assert.equal(skipped.reread, true);
});
