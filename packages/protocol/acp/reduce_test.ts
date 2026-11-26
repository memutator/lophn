import assert from "node:assert/strict";
import { test } from "node:test";

import { type AcpContext, acpUpdatesOf } from "../events/acp-project.ts";
import type { AgentEvent } from "../events/agent.ts";
import {
  type AcpItem,
  type AcpMessageItem,
  type AcpState,
  type AcpUpdate,
  acpStateSchema,
  acpUpdateSchema,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "./mod.ts";
import { ACP_CAPABILITIES, acpSessionMetaSchema } from "./session.ts";

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
    ["denied-tcl_01h455vb4pex5v6nkc6gd5f003", 5],
    ["msg_01h455vb4pex5v6nkc6gd5f003", 6],
    ["end-" + TURN, 7],
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
    agentName: () => null,
    // 저장된 본문을 실어 보내므로 snapshot을 다시 읽지 않아도 같은 상태가 된다.
    body: () => ({
      content: [{ type: "text", text: "Hi there" }],
      reasoning: null,
      cards: [],
    }),
    decision: () => ({ choice: "once", reason: null }),
  };
  const at = (n: number) => `2026-10-26T09:00:0${n}.000Z`;
  const events = [
    {
      type: "MessageReceived",
      at: at(0),
      payload: {
        message: "msg_01h455vb4pex5v6nkc6gd5f001",
        body: [{ type: "text", text: "go" }],
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
        body: [{ type: "text", text: "also" }],
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
          allowed_choices: ["once", "session", "reject"],
          reason: "shell command needs approval",
          outside_rewind: true,
          to_parent: false,
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
      type: "PermissionDenied",
      at: at(5),
      payload: {
        turn: TURN,
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5f003",
        denial: {
          tool: "shell.run",
          category: "shell",
          target_summary: "rm -rf ~",
          reason_kind: "floor",
          rule_pattern: "rm -rf ~",
          message: "blocked by floor rule",
          recovery_hint: null,
          recovery_action: { kind: "none" },
        },
      },
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
    "5:notice",
    "6:message",
    "7:notice",
  ]);
  assert.deepStrictEqual(once.queued, []);
  assert.equal(once.turn?.phase, "ended");
  const recorded = once.items[1];
  assert.deepStrictEqual(recorded?.kind === "message" && recorded.content, [
    { type: "text", text: "Hi there" },
  ]);
  const tool = once.items[2];
  assert.deepStrictEqual(
    tool?.kind === "tool" && [tool.state, tool.duration_ms, tool.detail.kind],
    ["ok", 2000, "edit"],
  );
  assert.equal(once.reread, false);

  // 본문을 못 읽은 agent message는 turn이 끝나면 다시 읽게 한다.
  const unread = reduceAcp(EMPTY_ACP_STATE, {
    type: "message_recorded",
    turn: TURN,
    message: "msg_01h455vb4pex5v6nkc6gd5f001",
    model_call: null,
    seq: 1,
    at: AT,
    body: null,
  });
  assert.equal(
    reduceAcp(unread, {
      type: "turn_ended",
      turn: TURN,
      at: AT,
      outcome: "completed",
      active_ms: 1,
      error: null,
      messages: [],
      seq: 2,
    }).reread,
    true,
  );

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
      origin: null,
      content: [{ type: "text", text: "hi" }],
      reasoning: null,
      cards: [],
      complete: true,
    },
  });
  assert.equal(skipped.reread, true);
});

// session 기능·계획·알림은 snapshot과 stream이 겹쳐도 두 번 접어 같아야 하고, 알림의 순번 빈틈은 다른 항목처럼 다시 읽게 한다.
test("session_changed·plan_changed·notice_added는 두 번 접어도 같고 notice_added의 순번 빈틈은 다시 읽게 한다", () => {
  const meta = acpSessionMetaSchema.parse({
    title: null,
    cli_session: "cli-1",
    capabilities: Object.fromEntries(
      ACP_CAPABILITIES.map((name) => [name, false]),
    ),
    models: [],
    model: null,
    modes: [],
    mode: null,
    commands: [],
    usage: null,
    toggles: [],
    goal: null,
    roles: null,
    harness: "codex",
  });
  const notice = (seq: number): AcpUpdate => ({
    type: "notice_added",
    item: {
      kind: "notice",
      id: `info-${seq}`,
      seq,
      at: AT,
      turn: TURN,
      notice: { type: "info", text: "compacted", level: "info" },
    },
  });
  const updates: AcpUpdate[] = [
    { type: "session_changed", session: meta },
    { type: "session_changed", session: { title: "renamed", mode: "plan" } },
    {
      type: "plan_changed",
      entries: [{ text: "write", status: "in_progress" }],
    },
    notice(1),
  ];
  let once = EMPTY_ACP_STATE;
  let twice = EMPTY_ACP_STATE;
  for (const update of updates) {
    once = reduceAcp(once, update);
    twice = reduceAcp(reduceAcp(twice, update), update);
  }
  assert.deepStrictEqual(twice, once);
  assert.equal(once.session?.title, "renamed");
  assert.equal(once.session?.cli_session, "cli-1");
  assert.equal(once.items.length, 1);
  assert.equal(once.reread, false);

  assert.equal(reduceAcp(once, notice(3)).reread, true);
  // 첫 session_changed를 놓치면 부분 갱신으로 session을 만들지 않는다.
  const missed = reduceAcp(EMPTY_ACP_STATE, {
    type: "session_changed",
    session: { title: "x" },
  });
  assert.equal(missed.session, null);
  assert.equal(missed.reread, true);
});

const CHILD = "sub-1";
const message = (id: string, seq: number): AcpMessageItem => ({
  kind: "message",
  id,
  seq,
  at: AT,
  actor: "user",
  sender: null,
  call: null,
  reply_to: null,
  delivery: "next_turn",
  turn: null,
  origin: null,
  content: [{ type: "text", text: id }],
  reasoning: null,
  cards: [],
  complete: true,
});

// subagent 대화가 바깥 대화와 섞이거나 사라지면 사람이 자식이 한 일을 못 본다. 자식은 같은 reducer로 접히고,
// 자식 안의 순번 빈틈은 바깥도 다시 읽게 한다.
test("child_update는 같은 reducer로 children에 접히고 두 번 접어도 같으며 자식의 순번 빈틈은 바깥 reread를 세운다", () => {
  const add = (id: string, seq: number): AcpUpdate => ({
    type: "child_update",
    child: CHILD,
    update: { type: "message_added", item: message(id, seq) },
  });
  const first = add("msg_1", 1);
  const once = reduceAcp(EMPTY_ACP_STATE, first);
  assert.deepStrictEqual(reduceAcp(once, first), once);
  assert.deepStrictEqual(
    once.children[CHILD]?.items.map((i) => i.id),
    ["msg_1"],
  );
  assert.deepStrictEqual(once.items, []);
  assert.equal(once.reread, false);
  acpStateSchema.parse(once);

  const gap = reduceAcp(once, add("msg_3", 3));
  assert.equal(gap.children[CHILD]?.reread, true);
  assert.equal(gap.reread, true);
});

// 되살린 구간이 다른 자리로 가면 대화 순서가 틀어져 사람이 읽는 흐름이 깨진다.
test("hidden_restored는 숨긴 항목을 같은 seq 자리로 돌리고 두 번 접어도 같다", () => {
  const inner = [message("msg_2", 2), message("msg_3", 3)];
  const hidden: AcpItem = {
    kind: "hidden",
    id: "hid_1",
    seq: 2,
    at: AT,
    checkpoint: "msg_2",
    choice: "messages_only",
    count: 2,
    restored: 0,
    left: [],
    items: inner,
  };
  const state: AcpState = {
    ...EMPTY_ACP_STATE,
    seq: 4,
    items: [message("msg_1", 1), hidden, message("msg_4", 4)],
  };
  const update: AcpUpdate = { type: "hidden_restored", hidden: "hid_1" };
  const once = reduceAcp(state, update);
  assert.deepStrictEqual(
    once.items.map((i) => `${i.seq}:${i.id}`),
    ["1:msg_1", "2:msg_2", "3:msg_3", "4:msg_4"],
  );
  assert.equal(once.seq, 4);
  assert.deepStrictEqual(reduceAcp(once, update), once);
});

// 같은 탭에서 CLI session을 바꾼 뒤 옛 대화가 남거나, seq를 처음부터 세어 빈 seq를 순번 빠짐으로 보고 snapshot을 계속
// 다시 읽으면 사람이 새 session을 못 본다.
test("session_reset은 대화를 비우고 session과 seq만 남기며 이어지는 seq를 다시 읽게 하지 않고 두 번 접어도 같다", () => {
  const meta = acpSessionMetaSchema.parse({
    title: "old",
    cli_session: "cli-1",
    capabilities: Object.fromEntries(
      ACP_CAPABILITIES.map((name) => [name, false]),
    ),
    models: [],
    model: null,
    modes: [],
    mode: null,
    commands: [],
    usage: null,
    toggles: [],
    goal: null,
    roles: null,
    harness: "codex",
  });
  const full: AcpState = {
    ...EMPTY_ACP_STATE,
    seq: 2,
    items: [message("msg_1", 1), message("msg_2", 2)],
    turn: { id: TURN, phase: "working", started_at: AT, elapsed: null },
    queued: [{ id: "msg_q", at: AT, content: [] }],
    pending: {
      approval: null,
      question: { group: "grp_1", tool_call: "tcl_1", questions: null },
    },
    writing: {
      turn: TURN,
      model_call: CALL_1,
      text: "x",
      reasoning: "",
      at: AT,
    },
    dropped: { model_call: CALL_1, turn: null },
    session: meta,
    plan: { entries: [{ text: "a", status: "pending" }] },
    children: { [CHILD]: { ...EMPTY_ACP_STATE, seq: 1 } },
    tasks: [
      {
        id: "t1",
        kind: "shell",
        description: "d",
        state: "running",
        started_at: null,
        output: null,
      },
    ],
    draft: { key: "d1", content: [] },
  };
  const reset: AcpUpdate = { type: "session_reset" };
  const once = reduceAcp(full, reset);
  assert.deepStrictEqual(once, {
    ...EMPTY_ACP_STATE,
    seq: 2,
    session: meta,
  });
  assert.deepStrictEqual(reduceAcp(once, reset), once);

  const next = reduceAcp(once, {
    type: "message_added",
    item: message("msg_3", 3),
  });
  assert.deepStrictEqual(
    next.items.map((i) => i.id),
    ["msg_3"],
  );
  assert.equal(next.reread, false);
  acpStateSchema.parse(next);
});

test("이미 닫힌 승인의 늦은 approval_opened는 죽은 승인 카드를 되살리지 않는다", () => {
  const approval = {
    id: "apr_01",
    subject: { kind: "shell" as const, command: "ls" },
    choices: ["once" as const, "reject" as const],
    always_patterns: [],
  };
  const opened = reduceAcp(EMPTY_ACP_STATE, {
    type: "approval_opened",
    approval,
  });
  const closed = reduceAcp(opened, {
    type: "approval_closed",
    request: "apr_01",
    outcome: "allowed",
    choice: "once",
    reason: null,
    mode: null,
    seq: 1,
    at: AT,
  });
  assert.equal(closed.pending.approval, null);

  // snapshot 이전에 떠 있던 approval_opened가 닫힌 snapshot 위에 뒤늦게 접혀도 무시한다.
  const late = reduceAcp(closed, {
    type: "approval_opened",
    approval,
  });
  assert.equal(late.pending.approval, null);
  assert.equal(late.reread, false);
  acpStateSchema.parse(late);
});
