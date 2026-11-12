import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type AcpState,
  type AcpUpdate,
  acpSessionMetaSchema,
  acpStateSchema,
  acpUpdateSchema,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../protocol/acp/mod.ts";
import type { AgentEvent } from "../../../../protocol/events/mod.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { commandsList } from "../../../../protocol/lophn-agent/commands.ts";
import { messageBody } from "../../../../protocol/lophn-agent/mod.ts";
import {
  modelCatalogRead,
  shownModelsRead,
} from "../../../../protocol/lophn-agent/models.ts";
import { modelCallList } from "../../../../protocol/lophn-agent/model-calls.ts";
import { providerList } from "../../../../protocol/lophn-agent/providers.ts";
import { sessionStatusRead } from "../../../../protocol/lophn-agent/session-status.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { receivedMessageList } from "../../../../protocol/lophn-agent/received-messages.ts";
import { rewindList } from "../../../../protocol/lophn-agent/reverts.ts";
import {
  toolCallList,
  toolCallRead,
} from "../../../../protocol/lophn-agent/tool-calls.ts";
import {
  turnBody,
  turnList,
} from "../../../../protocol/lophn-agent/turn-reads.ts";
import {
  type AcpAlloc,
  type AcpCaptured,
  type AcpEnv,
  type AcpStoredItem,
  acpUpdatesFor,
  buildAcpState,
  currentTurn,
  readDraftMeta,
  readSessionMeta,
  sessionChangeOf,
} from "./acp-build.ts";

const SECRET = "sk-live-SECRET";
const SES = "ses_01h455vb4pex5v6nkc6gd5f001";
const TURN = "trn_01h455vb4pex5v6nkc6gd5f001";
const MCL = "mcl_01h455vb4pex5v6nkc6gd5f001";
const HUMAN = "msg_01h455vb4pex5v6nkc6gd5f001";
const AGENT = "msg_01h455vb4pex5v6nkc6gd5f002";
const TOOL = "tcl_01h455vb4pex5v6nkc6gd5f001";
const APR = "apr_01h455vb4pex5v6nkc6gd5f001";
const at = (n: number) => `2026-10-26T09:00:0${n}.000Z`;

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 기록에는 secret이 그대로 들어 있다고 본다. ACP로 나가는 글은 모두 redact를 거쳐야 한다.
const records = new Map<string, unknown>([
  [
    key(workspaceSessionRead),
    { session: { agent: "lophn_home", title: `title ${SECRET}` } },
  ],
  [
    key(receivedMessageList),
    {
      messages: [
        {
          id: HUMAN,
          from: { kind: "human" },
          call: null,
          reply_to: null,
          turn: TURN,
          delivery: "next_turn",
          created_seq: "1",
          created_at: at(0),
        },
        {
          id: AGENT,
          from: { kind: "agent", session: SES },
          call: null,
          reply_to: null,
          turn: TURN,
          delivery: "next_turn",
          created_seq: "2",
          created_at: at(2),
        },
      ],
      next_cursor: null,
    },
  ],
  [
    key(turnList),
    {
      turns: [
        {
          id: TURN,
          session: SES,
          input_message: HUMAN,
          state: "finished",
          started_at: at(0),
          finished_at: at(6),
          outcome: { kind: "completed", reason: "answer_completed" },
          elapsed: { active_ms: 5000, stall_ms: 0, checkpoint_at: null },
          state_seq: "3",
        },
      ],
      next_cursor: null,
    },
  ],
  [
    key(toolCallList),
    {
      tool_calls: [
        {
          id: TOOL,
          turn: TURN,
          model_call: MCL,
          tool: "file.edit",
          state: "finished",
          outcome: { kind: "success" },
          started_at: at(2),
          finished_at: at(4),
          duration_ms: 2000,
          display: { category: "other", title: "Edit a.md" },
        },
      ],
      next_cursor: null,
    },
  ],
  [key(toolCallRead), { tool_call: toolCall() }],
  [key(rewindList), { reverts: [], hidden_from_seq: null, next_cursor: null }],
]);

function toolCall() {
  return {
    id: TOOL,
    tool: "file.edit",
    state: "finished",
    outcome: { kind: "success" },
  };
}

const bodies: Record<string, unknown> = {
  [HUMAN]: {
    schema_version: 1,
    parts: [{ kind: "text", text: `go ${SECRET}` }],
  },
  [AGENT]: {
    schema_version: 1,
    parts: [
      { kind: "reasoning", text: `think ${SECRET}`, duration_ms: 10 },
      { kind: "text", text: `done ${SECRET}` },
      {
        kind: "harness_tool",
        name: "Bash",
        summary: SECRET,
        status: "done",
      },
    ],
  },
};

function env(): AcpEnv {
  return {
    async read<T>(
      route: { resource: string; method: string },
      input: unknown,
    ): Promise<Result<T>> {
      // 진짜 route처럼 입력 schema를 지킨다. 가짜 읽기가 route가 거절하는 입력을 받아 주면 화면 칸이 빈 bug를 놓친다.
      const schema = (
        route as { input?: { safeParse(value: unknown): { success: boolean } } }
      ).input;
      if (schema !== undefined && !schema.safeParse(input).success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      if (key(route) === key(messageBody)) {
        const message = (input as { message: string }).message;
        return ok({ content: bodies[message] } as T);
      }
      if (key(route) === key(turnBody)) {
        const { kind } = input as { kind: string };
        return ok({
          value:
            kind === "tool_call_input"
              ? { path: `a-${SECRET}.md`, new_string: "x\ny" }
              : {},
        } as T);
      }
      return ok(records.get(key(route)) as T);
    },
    redact: (text) => text.replaceAll(SECRET, "[redacted]"),
  };
}

const event = (type: string, atMs: number, payload: unknown) =>
  ({ session: SES, type, at: at(atMs), payload }) as unknown as AgentEvent;

const NONE: AcpCaptured = {
  queuedHuman: false,
  decision: null,
  questions: null,
};

// 같은 기록에서 snapshot과 갱신을 접은 상태가 같고, 어느 쪽에도 redaction 안 된 글이 없다.
// "tool 본문이 없다"는 agent tool만 본다. 사람이 `!`로 돌린 줄(`by: "user"`)의 body는 저장 전에 redaction을 거친
// 값(message-body.ts)이라 snapshot과 갱신이 그대로 싣는다.
test("snapshot과 갱신을 접은 상태가 같고 ACP에 redaction 안 된 글과 tool 본문이 없다", async () => {
  const stored = new Map<string, AcpStoredItem>();
  const allocate = (_session: string, items: AcpAlloc[]) => {
    const seqs = new Map<string, number>();
    for (const item of items) {
      if (!stored.has(item.id)) {
        stored.set(item.id, { ...item, seq: stored.size + 1 });
      }
      seqs.set(item.id, stored.get(item.id)!.seq);
    }
    return Promise.resolve(ok(seqs));
  };
  const openRequests = new Map();
  const deps = { env: env(), allocate, openRequests };

  const events: [AgentEvent, AcpCaptured][] = [
    [
      event("MessageReceived", 0, {
        message: HUMAN,
        body: [{ type: "text", text: `go ${SECRET}` }],
        from: { kind: "human" },
        call: null,
        reply_to: null,
        steer: false,
      }),
      NONE,
    ],
    [event("TurnStarted", 0, { turn: TURN, input_message: HUMAN }), NONE],
    [
      event("MessageRecorded", 2, {
        turn: TURN,
        message: AGENT,
        model_call: MCL,
      }),
      NONE,
    ],
    [
      event("ToolCallStarted", 2, {
        turn: TURN,
        tool_call: TOOL,
        tool: "file.edit",
        display: { category: "other", title: "Edit a.md" },
      }),
      NONE,
    ],
    [
      event("ToolCallEnded", 4, { turn: TURN, tool_call: TOOL, outcome: "ok" }),
      NONE,
    ],
    [
      event("TurnRequestOpened", 4, {
        request: {
          id: APR,
          session: SES,
          turn: TURN,
          tool_call: TOOL,
          subject: { kind: "shell", command: `curl ${SECRET}` },
          always_patterns: [],
          created_at: at(4),
        },
      }),
      NONE,
    ],
    [
      event("TurnRequestClosed", 5, { request: APR, outcome: "allow" }),
      {
        ...NONE,
        decision: Promise.resolve({ choice: "once" as const, reason: null }),
      },
    ],
    [
      event("TurnEnded", 6, {
        turn: TURN,
        outcome: { kind: "completed", reason: "answer_completed" },
        messages: [HUMAN, AGENT],
        active_ms: 5000,
        error: null,
      }),
      NONE,
    ],
  ];

  const updates: AcpUpdate[] = [];
  let folded: AcpState = EMPTY_ACP_STATE;
  for (const [one, cap] of events) {
    for (const update of await acpUpdatesFor(deps, one, cap)) {
      acpUpdateSchema.parse(update);
      updates.push(update);
      folded = reduceAcp(folded, update);
    }
  }

  const snapshot = await buildAcpState(deps.env, SES, {
    steering: new Set(),
    writing: null,
    elapsed: null,
    approval: null,
    question: null,
    session: null,
    stored: [...stored.values()],
    allocate: (items) => allocate(SES, items),
  });
  assert.ok(snapshot.ok);
  acpStateSchema.parse(snapshot.value);
  assert.deepStrictEqual(snapshot.value, folded);

  for (const out of [JSON.stringify(updates), JSON.stringify(snapshot.value)]) {
    assert.ok(!out.includes(SECRET), "secret must not reach ACP");
  }
  // 글이 빠진 것이 아니라 가려진 것이다.
  const agent = snapshot.value.items.find((item) => item.id === AGENT);
  assert.ok(agent?.kind === "message" && agent.complete);
  assert.deepStrictEqual(agent.content[0], {
    type: "text",
    text: "done [redacted]",
  });
});

// 편집·call·질문은 tool 이름이 정하는 종류를 시작 때부터 갖고, 실패해도 generic으로 돌아가지 않는다.
test("tool의 종류는 시작 때부터 있고 실패해도 지킨다", async () => {
  const base = env();
  const allocate = (_session: string, items: AcpAlloc[]) =>
    Promise.resolve(ok(new Map(items.map((item) => [item.id, 1]))));
  const run = async (tool: string, outcome: "ok" | "error" | "denied") => {
    const reads = (state: "running" | "finished"): AcpEnv => ({
      read: <T>(route: { resource: string; method: string }, input: unknown) =>
        key(route) === key(toolCallRead)
          ? Promise.resolve(
              ok({
                tool_call: {
                  id: TOOL,
                  tool,
                  state,
                  outcome:
                    state === "running"
                      ? null
                      : outcome === "ok"
                        ? { kind: "success" }
                        : { kind: "failed", code: "x" },
                },
              } as T),
            )
          : base.read<T>(route, input),
      redact: base.redact,
    });
    const deps = (state: "running" | "finished") => ({
      env: reads(state),
      allocate,
      openRequests: new Map(),
    });
    const started = await acpUpdatesFor(
      deps("running"),
      event("ToolCallStarted", 2, {
        turn: TURN,
        tool_call: TOOL,
        tool,
        display: { category: "other", title: tool },
      }),
      NONE,
    );
    const ended = await acpUpdatesFor(
      deps("finished"),
      event("ToolCallEnded", 4, { turn: TURN, tool_call: TOOL, outcome }),
      NONE,
    );
    let state = EMPTY_ACP_STATE;
    for (const update of [...started, ...ended]) {
      state = reduceAcp(state, update);
    }
    return { started, state };
  };

  const edit = await run("file.edit", "error");
  const first = edit.started[0];
  assert.ok(first?.type === "tool_started");
  // 입력(path, new_string)에서 뽑은 칸이 시작 때부터 차 있다.
  assert.deepStrictEqual(first.item.detail, {
    kind: "edit",
    document: "a-[redacted].md",
    path: "a-[redacted].md",
    added: 2,
    removed: 0,
  });
  const failedEdit = edit.state.items[0];
  assert.ok(failedEdit?.kind === "tool");
  assert.equal(failedEdit.state, "error");
  assert.equal(failedEdit.detail.kind, "edit");

  // 보내지 못한 call은 id와 상태가 끝까지 없다.
  const send = await run("call.send", "denied");
  const sent = send.state.items[0];
  assert.ok(sent?.kind === "tool");
  assert.equal(sent.state, "denied");
  assert.ok(sent.detail.kind === "call" && sent.detail.call === null);

  // 질문은 실제 core도 도는 ask에 question을 단다(fake scene과 같다).
  const ask = await run("ask", "ok");
  const asked = ask.started[0];
  assert.ok(asked?.type === "tool_started");
  assert.equal(asked.item.detail.kind, "question");
});

// rename 뒤의 session_changed를 접은 상태가 그때의 snapshot 칸과 같고, 제목은 redaction을 거친다.
test("rename 뒤의 session_changed를 접은 session meta가 snapshot의 것과 같다", async () => {
  let title = "old";
  const read = <T>(route: { resource: string; method: string }) => {
    const found: Record<string, unknown> = {
      [key(workspaceSessionRead)]: {
        session: {
          agent: "lophn_home",
          workspace: null,
          title,
          skip: false,
          model_selection: null,
        },
      },
      [key(providerList)]: { providers: [], next_cursor: null },
      [key(modelCatalogRead)]: { entries: [], next_cursor: null },
      [key(shownModelsRead)]: { shown: { items: [] } },
      [key(agentRead)]: { effective: { model: null } },
      [key(sessionStatusRead)]: {
        context: null,
        tokens: { input: 1, output: 2, cache_read: null, cache_write: null },
        turns: 1,
        costs: [],
        provider: null,
      },
      [key(commandsList)]: { commands: [] },
    };
    return Promise.resolve(ok(found[key(route)] as T));
  };
  const e: AcpEnv = {
    read,
    redact: (text) => text.replaceAll(SECRET, "[redacted]"),
  };

  const before = await readSessionMeta(e, SES, read);
  assert.ok(before !== null);
  title = `new ${SECRET}`;
  const update = await sessionChangeOf(e, SES, "title");
  assert.ok(update !== null);
  const folded = reduceAcp({ ...EMPTY_ACP_STATE, session: before }, update);

  const after = await readSessionMeta(e, SES, read);
  assert.ok(after !== null);
  acpSessionMetaSchema.parse(after);
  assert.deepStrictEqual(folded.session, after);
  assert.equal(after.title, "new [redacted]");
});

// 첫 메시지 전 화면이 보는 draft meta는 같은 agent·workspace로 연 새 session의 meta에서 title·usage·cli_session을 뺀 것과 같다.
// 다르면 첫 메시지를 보낸 순간 model 단추나 mode가 바뀐다.
test("draft meta는 같은 agent와 workspace로 연 session의 meta에서 title·usage·cli_session을 뺀 것과 같다", async () => {
  const workspace = { kind: "project", id: "prj_01h455vb4pex5v6nkc6gd5f001" };
  const found: Record<string, unknown> = {
    [key(workspaceSessionRead)]: {
      session: {
        agent: "lophn_home",
        workspace,
        title: null,
        skip: false,
        harness: null,
        model_selection: null,
      },
    },
    [key(providerList)]: { providers: [], next_cursor: null },
    [key(modelCatalogRead)]: { entries: [], next_cursor: null },
    [key(shownModelsRead)]: { shown: { items: [] } },
    [key(agentRead)]: {
      effective: {
        model: {
          value: { provider: "prv_x", model_name: "m", option_values: {} },
          source: "agent",
        },
      },
    },
    [key(sessionStatusRead)]: {
      context: null,
      tokens: { input: 1, output: 2, cache_read: null, cache_write: null },
      turns: 1,
      costs: [],
      provider: null,
    },
    [key(commandsList)]: {
      commands: [
        {
          name: "new",
          title: "New session",
          description: "d",
          source: "builtin",
        },
        {
          name: "rename",
          title: "Rename",
          description: "d",
          source: "builtin",
        },
        {
          name: "release-notes",
          title: null,
          description: "s",
          source: "skill",
        },
      ],
    },
  };
  const read = <T>(route: { resource: string; method: string }) =>
    Promise.resolve(ok(found[key(route)] as T));
  const e: AcpEnv = { read, redact: (text) => text };

  const session = await readSessionMeta(e, SES, read);
  const draft = await readDraftMeta(
    e,
    { agent: "lophn_home", workspace } as never,
    read,
  );
  assert.ok(session !== null);
  acpSessionMetaSchema.parse(draft);
  // session이 있어야 하는 내장(rename)은 draft에 없다.
  assert.deepStrictEqual(draft, {
    ...session,
    title: null,
    usage: null,
    cli_session: null,
    commands: session.commands.filter((one) => one.name !== "rename"),
  });
  assert.equal(draft.model?.layer, "agent");
  assert.deepStrictEqual(
    draft.commands.map((one) => one.name),
    ["new", "release-notes"],
  );
  assert.deepStrictEqual(
    session.commands.map((one) => one.source),
    ["app", "app", "skill"],
  );
});

// 새 turn은 ledger head를 state_seq로 받아, 앞 turn이 끝난 뒤 event가 없었으면 끝난 앞 turn과 state_seq가 같다.
test("state_seq가 같아도 도는 turn이 지금 turn이다", () => {
  const turn = (id: string, state: "running" | "finished", n: number) =>
    ({ id, state, started_at: at(n), state_seq: "12867" }) as Parameters<
      typeof currentTurn
    >[0][number];
  const old = turn(TURN, "finished", 0);
  const next = turn("trn_01h455vb4pex5v6nkc6gd5f002", "running", 5);
  assert.equal(currentTurn([old, next])?.id, next.id);
  assert.equal(currentTurn([next, old])?.id, next.id);
  const ended = { ...next, state: "finished" as const };
  assert.equal(currentTurn([old, ended])?.id, next.id);
});

// 화면이 사용량 한도·로그인 거절·rate limit을 가르는 근거다. configuration_unavailable도 실패 call의 http_status를 싣는다.
test("configuration_unavailable로 끝난 turn의 error notice는 실패 call의 http_status를 싣는다", async () => {
  const base = env();
  const failedTurn = {
    ...(records.get(key(turnList)) as { turns: object[] }).turns[0],
    outcome: { kind: "failed", reason: "configuration_unavailable" },
  };
  const failedEnv: AcpEnv = {
    read: <T>(route: { resource: string; method: string }, input: unknown) => {
      if (key(route) === key(turnList)) {
        return Promise.resolve(
          ok({ turns: [failedTurn], next_cursor: null } as T),
        );
      }
      if (key(route) === key(modelCallList)) {
        return Promise.resolve(
          ok({
            calls: [
              {
                id: MCL,
                outcome: {
                  kind: "failed",
                  code: "quota",
                  retry_at: null,
                  finish_reason: null,
                  http_status: 402,
                  provider_code: null,
                  evidence: {
                    verdict_path: "http_status",
                    content_type: null,
                    request_id: null,
                    unknown_events: [],
                  },
                },
              },
            ],
            next_cursor: null,
          } as T),
        );
      }
      return base.read<T>(route, input);
    },
    redact: base.redact,
  };
  const snapshot = await buildAcpState(failedEnv, SES, {
    steering: new Set(),
    writing: null,
    elapsed: null,
    approval: null,
    question: null,
    session: null,
    stored: [],
    allocate: (items) =>
      Promise.resolve(ok(new Map(items.map((item) => [item.id, 1])))),
  });
  assert.ok(snapshot.ok);
  const notice = snapshot.value.items.find((item) => item.kind === "notice");
  assert.ok(notice?.kind === "notice" && notice.notice.type === "error");
  assert.equal(notice.notice.code, "configuration_unavailable");
  assert.equal(notice.notice.evidence?.http_status, 402);
});
