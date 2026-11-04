import assert from "node:assert/strict";
import { test } from "node:test";

import { ok, type Result } from "../../../../base/mod.ts";
import {
  type AcpState,
  type AcpUpdate,
  acpStateSchema,
  acpUpdateSchema,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../protocol/acp/mod.ts";
import type { AgentEvent } from "../../../../protocol/events/mod.ts";
import { messageBody } from "../../../../protocol/lophn-agent/mod.ts";
import { placeSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
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
    key(placeSessionRead),
    { session: { agent: "lophn", title: `title ${SECRET}` } },
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
