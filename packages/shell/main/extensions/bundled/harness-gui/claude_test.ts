import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../../../../base/clock.ts";
import { createIdSource } from "../../../../../base/id.ts";
import { seededRandom } from "../../../../../base/random.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type { AcpState, AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { AcpSessionHandle } from "../../../../../protocol/extensions/mod.ts";
import type {
  CanUseTool,
  Options,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createClaudeAdapter, type ClaudeSdk } from "./claude.ts";

// 녹화(fixtures/claude)로 adapter를 돌린다. 실제 `claude`는 띄우지 않고, SDK의 query()를 녹화 메시지를 내는
// 대역으로 바꾸고 canUseTool은 test가 직접 부른다.

type Entry = { kind: string; data: unknown };
type Permission = {
  toolName: string;
  input: { questions: { question: string }[] };
  options: { toolUseID: string; requestId: string };
};
const textOf = (entry: Entry) => entry.data as string;
const fixtures = fileURLToPath(new URL("./fixtures/claude/", import.meta.url));
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(options: { history?: unknown[]; resume?: string } = {}) {
  const sdkMessages: unknown[] = [];
  let wake: (() => void) | undefined;
  const sent: string[] = [];
  let interrupted = 0;
  let queryOptions: Options | undefined;
  const sdk = {
    query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
      queryOptions = params.options;
      void (async () => {
        for await (const message of params.prompt) {
          sent.push(message.message.content as string);
        }
      })();
      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            const next = sdkMessages.shift();
            if (next !== undefined) yield next;
            else await new Promise<void>((resolve) => (wake = resolve));
          }
        },
        interrupt: () => {
          interrupted += 1;
          return Promise.resolve();
        },
        close() {},
      };
    },
    getSessionMessages: () => Promise.resolve(options.history ?? []),
  } as unknown as ClaudeSdk;

  let state: AcpState = EMPTY_ACP_STATE;
  const updates: AcpUpdate[] = [];
  let listener: ((input: AcpInput) => void) | undefined;
  const session: AcpSessionHandle = {
    id: "win_test",
    publish(update) {
      updates.push(update);
      state = reduceAcp(state, update);
    },
    onInput: (fn) => void (listener = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const started = await createClaudeAdapter(sdk).start({
    terminal: null,
    cwd: "/work/test",
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    session,
    spawn: () => {
      throw new Error("the fake query never spawns");
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  assert.equal(started.ok, true);

  return {
    sent,
    get state() {
      return state;
    },
    get interrupted() {
      return interrupted;
    },
    get queryOptions() {
      return queryOptions;
    },
    async input(input: Record<string, unknown>) {
      listener?.({ session: "ses_x", ...input } as AcpInput);
      await flush();
    },
    send: (id: string, text: string) =>
      // test 쪽 id는 형식을 보지 않는다.
      ({
        type: "send",
        id: `msg_${id}`,
        key: id,
        content: [{ type: "text", text }],
        delivery: "next_turn",
      }),
    async feed(message: unknown) {
      sdkMessages.push(message);
      wake?.();
      await flush();
    },
    /** 녹화에서 `message` 줄을 다음 message 아닌 줄 앞까지 SDK 메시지로 내보낸다. 그 줄을 돌려준다. */
    async play(
      rec: Entry[],
      cursor: { at: number },
    ): Promise<Entry | undefined> {
      while (cursor.at < rec.length) {
        const entry = rec[cursor.at++] as Entry;
        if (entry.kind !== "message") return entry;
        await this.feed(entry.data);
      }
      return undefined;
    },
    askPermission(entry: Entry) {
      const settled = { done: false };
      const permission = entry.data as Permission;
      const canUseTool = queryOptions?.canUseTool as CanUseTool;
      const result = canUseTool(permission.toolName, permission.input, {
        ...permission.options,
        signal: new AbortController().signal,
      }) as Promise<unknown>;
      void result.then(() => (settled.done = true));
      return { result, settled };
    },
  };
}

const seqs = (state: AcpState) => state.items.map((item) => item.seq);
const contiguous = (state: AcpState) =>
  assert.deepEqual(
    seqs(state),
    seqs(state).map((_, index) => index + 1),
  );
const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));

const approvalRows = [
  { name: "deny", choice: { kind: "reject" }, tool: "denied" },
  { name: "approve_session", choice: { kind: "always" }, tool: "ok" },
] as const;

for (const row of approvalRows) {
  test(`승인 요청은 창이 답하기 전까지 tool을 실행하지 않고 답대로 끝난다 (${row.name})`, async () => {
    const t = await setup();
    // bypassPermissions는 어떤 길로도 쓰지 않는다.
    assert.equal(t.queryOptions?.permissionMode, undefined);
    assert.equal(t.queryOptions?.allowDangerouslySkipPermissions, undefined);

    const rec = recording(row.name);
    const cursor = { at: 0 };
    await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
    const asked = (await t.play(rec, cursor)) as Entry;
    assert.equal(asked.kind, "can_use_tool");
    const { result, settled } = t.askPermission(asked);
    await flush();

    // 창이 답하기 전: SDK는 허락을 못 받았고 카드가 떠 있다.
    assert.equal(settled.done, false);
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.equal(t.state.turn?.phase, "waiting");
    assert.equal(tools(t.state)[0]?.state, "running");

    await t.input({ type: "decide", request: approval.id, choice: row.choice });
    const recorded = (await t.play(rec, cursor)) as Entry;
    assert.equal(recorded.kind, "permission_result");
    assert.deepEqual(await result, recorded.data);
    await t.play(rec, cursor);

    assert.equal(tools(t.state)[0]?.state, row.tool);
    assert.equal(t.state.pending.approval, null);
    assert.equal(t.state.turn?.phase, "ended");
    assert.equal(t.state.reread, false);
    contiguous(t.state);
  });
}

test("AskUserQuestion은 ACP 질문으로 나가고 답이 updatedInput.answers로 돌아간다", async () => {
  const t = await setup();
  const rec = recording("question");
  const cursor = { at: 0 };
  await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
  const asked = (await t.play(rec, cursor)) as Entry;
  const { result, settled } = t.askPermission(asked);
  await flush();

  const question = t.state.pending.question;
  assert.ok(question);
  assert.equal(settled.done, false);
  assert.equal(t.state.pending.approval, null);

  const text = (asked.data as Permission).input.questions[0]
    ?.question as string;
  await t.input({
    type: "answer",
    tool_call: question.tool_call,
    answers: [{ question: text, status: "answered", answer: ["Blue"] }],
  });
  const recorded = (await t.play(rec, cursor)) as Entry;
  assert.deepEqual(await result, recorded.data);
  await t.play(rec, cursor);

  const line = tools(t.state)[0]?.detail;
  assert.ok(line?.kind === "question");
  assert.equal(line.outcome, "submitted");
  assert.deepEqual(line.lines, [{ header: "Color", answer: "Blue" }]);
  assert.equal(t.state.reread, false);
  contiguous(t.state);
});

for (const scenario of ["queue", "interrupt"] as const) {
  test(`도는 중 보낸 메시지는 turn이 끝난 뒤에야 SDK로 가고 대화가 이어진다 (${scenario})`, async () => {
    const t = await setup();
    const rec = recording(scenario);
    const cursor = { at: 0 };
    await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
    const second = (await t.play(rec, cursor)) as Entry;
    assert.equal(second.kind, "send");

    if (scenario === "interrupt") {
      await t.input({ type: "stop", turn: "trn_x", key: "stop" });
      assert.equal(t.interrupted, 1);
    }
    await t.input(t.send("2", textOf(second)));
    assert.equal(t.state.queued.length, 1);
    assert.equal(t.sent.length, 1);

    await t.play(rec, cursor);
    assert.deepEqual(t.sent, [textOf(rec[0] as Entry), textOf(second)]);
    assert.equal(t.state.queued.length, 0);
    const users = t.state.items.flatMap((item) =>
      item.kind === "message" && item.actor === "user" ? [item] : [],
    );
    assert.deepEqual(
      users.map((item) => item.id),
      ["msg_1", "msg_2"],
    );
    assert.notEqual(users[0]?.turn, users[1]?.turn);
    const ends = t.state.items.flatMap((item) =>
      item.kind === "notice" && item.notice.type === "turn_end"
        ? [item.notice.outcome]
        : [],
    );
    assert.deepEqual(ends, [
      scenario === "queue" ? "completed" : "stopped",
      "completed",
    ]);
    assert.equal(t.state.reread, false);
    contiguous(t.state);
  });
}

test("resume은 SDK resume으로 넘기고 앞 대화를 transcript로 다시 그린다", async () => {
  const history = JSON.parse(
    readFileSync(`${fixtures}resume-history.json`, "utf8"),
  );
  const t = await setup({
    history,
    resume: "92f4aba9-f419-4338-aaa4-a04f5146a533",
  });
  await flush();
  assert.equal(t.queryOptions?.resume, "92f4aba9-f419-4338-aaa4-a04f5146a533");
  const texts = t.state.items.flatMap((item) =>
    item.kind === "message" ? [[item.actor, item.content[0]]] : [],
  );
  assert.deepEqual(texts, [
    [
      "user",
      {
        type: "text",
        text: "Reply with exactly this sentence and nothing else: Hello from the GUI fixture.",
      },
    ],
    ["agent", { type: "text", text: "Hello from the GUI fixture." }],
  ]);
  assert.equal(t.state.turn?.phase, "ended");
  assert.equal(t.state.reread, false);
  contiguous(t.state);
});
