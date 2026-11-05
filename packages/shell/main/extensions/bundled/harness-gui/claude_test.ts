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
import type {
  AcpSessionHandle,
  AcpTerminal,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
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
  input: Record<string, unknown> & { questions: { question: string }[] };
  options: { toolUseID: string; requestId: string; suggestions?: unknown[] };
};
const textOf = (entry: Entry) => entry.data as string;
const fixtures = fileURLToPath(new URL("./fixtures/claude/", import.meta.url));
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    // 녹화에 든 옛 형태(문자열 send)와 새 형태({type:"user"})를 모두 읽는다.
    .map((entry: Entry & { uuid?: string }) =>
      entry.kind === "send" && typeof entry.data === "object"
        ? {
            ...entry,
            uuid: (entry.data as SDKUserMessage).uuid,
            data: (entry.data as SDKUserMessage).message.content,
          }
        : entry,
    );

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Fake = {
  options: Options;
  sent: SDKUserMessage[];
  closed: boolean;
};

/** 대역 process. `exit()`가 불려야 끝난다. */
function fakeProcess() {
  const exits: Array<(code: number | null) => void> = [];
  const proc: ExtensionProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {},
    onStdout() {},
    onStderr() {},
    onExit: (listener) => void exits.push(listener),
  };
  return { proc, exit: () => exits.forEach((listener) => listener(0)) };
}

async function setup(
  options: {
    history?: unknown[];
    resume?: string;
    terminal?: AcpTerminal | null;
    /** false면 query를 닫아도 process가 끝나지 않는다(test가 `exit()`를 부른다). */
    autoExit?: boolean;
  } = {},
) {
  const sdkMessages: unknown[] = [];
  let wake: (() => void) | undefined;
  const queries: Fake[] = [];
  const processes: ReturnType<typeof fakeProcess>[] = [];
  const spawn = () => {
    const made = fakeProcess();
    processes.push(made);
    return made.proc;
  };
  const sdk = {
    query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
      const fake: Fake = { options: params.options, sent: [], closed: false };
      queries.push(fake);
      void (async () => {
        for await (const message of params.prompt) fake.sent.push(message);
      })();
      params.options.spawnClaudeCodeProcess?.({
        command: "claude",
        args: [],
        env: {},
        signal: new AbortController().signal,
      });
      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            const next = sdkMessages.shift();
            if (next !== undefined) yield next;
            else await new Promise<void>((resolve) => (wake = resolve));
          }
        },
        interrupt: () => Promise.resolve(),
        close() {
          fake.closed = true;
          if (options.autoExit !== false) processes.at(-1)?.exit();
        },
        supportedModels: () => Promise.resolve([]),
        supportedCommands: () => Promise.resolve([]),
        getContextUsage: () =>
          Promise.resolve({
            totalTokens: 1,
            maxTokens: 2,
            model: "m",
            categories: [],
          }),
        cancelAsyncMessage: () => Promise.resolve(true),
        rewindFiles: () => Promise.resolve({ canRewind: true }),
      };
    },
    getSessionMessages: () => Promise.resolve(options.history ?? []),
    getSubagentMessages: () => Promise.resolve([]),
    getSessionInfo: () => Promise.resolve(undefined),
    readFile: () => Promise.reject(new Error("no files in this test")),
  } as unknown as ClaudeSdk;

  let state: AcpState = EMPTY_ACP_STATE;
  let listener: ((input: AcpInput) => void) | undefined;
  const session: AcpSessionHandle = {
    id: "win_test",
    publish(update: AcpUpdate) {
      state = reduceAcp(state, update);
    },
    onInput: (fn) => void (listener = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const adapter = createClaudeAdapter(sdk);
  const started = await adapter.start({
    terminal: options.terminal ?? null,
    cwd: "/work/test",
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    session,
    spawn,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });

  return {
    adapter,
    started,
    queries,
    processes,
    get state() {
      return state;
    },
    get queryOptions() {
      return queries.at(-1)?.options;
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
    /** 녹화의 사람 메시지 uuid를 adapter가 실제로 보낸 uuid로 바꿔 읽는다. */
    rename: new Map<string, string>(),
    async feed(message: unknown) {
      let text = JSON.stringify(message);
      for (const [from, to] of this.rename) text = text.replaceAll(from, to);
      sdkMessages.push(JSON.parse(text));
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
      const canUseTool = queryOptions()?.canUseTool as CanUseTool;
      const result = canUseTool(permission.toolName, permission.input, {
        ...permission.options,
        signal: new AbortController().signal,
      } as Parameters<CanUseTool>[2]) as Promise<unknown>;
      void result.then(() => (settled.done = true));
      return { result, settled };
    },
  };
  function queryOptions() {
    return queries.at(-1)?.options;
  }
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
  { name: "write_approval", choice: { kind: "once" }, tool: "ok" },
] as const;

for (const row of approvalRows) {
  test(`승인 요청은 창이 답하기 전까지 tool을 실행하지 않고 답대로 끝난다 (${row.name})`, async () => {
    const t = await setup();
    // 처음에는 mode를 넘기지 않고 bypassPermissions는 어떤 길로도 쓰지 않는다.
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

test("'이 session 동안' 허락은 영구 설정에 쓰지 않고 query를 다시 열 때 allowedTools로 되살린다", async () => {
  const t = await setup();
  const rec = recording("approve_bash");
  const cursor = { at: 0 };
  await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
  const asked = (await t.play(rec, cursor)) as Entry;
  const permission = asked.data as Permission;
  // SDK 제안은 이 허락을 localSettings(영구)에 쓰자고 한다.
  assert.ok(
    (permission.options.suggestions as { destination: string }[]).some(
      (one) => one.destination === "localSettings",
    ),
  );
  const { result } = t.askPermission(asked);
  await flush();
  const approval = t.state.pending.approval;
  assert.ok(approval);
  await t.input({
    type: "decide",
    request: approval.id,
    choice: { kind: "session" },
  });

  const answer = (await result) as {
    updatedPermissions: { destination: string }[];
  };
  assert.ok(answer.updatedPermissions.length > 0);
  assert.ok(
    answer.updatedPermissions.every((one) => one.destination === "session"),
  );

  // rewind가 query를 다시 연다. 기억한 규칙이 새 query의 allowedTools에 든다.
  const userMessage = t.queries[0]?.sent[0];
  assert.ok(userMessage?.uuid);
  const first = (t.state.items.find((item) => item.kind === "message")?.id ??
    "") as string;
  await t.input({
    type: "rewind",
    key: "r",
    message: first,
    files: false,
    apps: [],
  });
  await flush();
  assert.equal(t.queries.length, 2);
  assert.deepEqual(t.queryOptions?.allowedTools, ["Bash(touch one.txt)"]);
  assert.equal(t.queryOptions?.permissionMode, "acceptEdits");
});

test("toggle은 한 session에 두 process를 같이 띄우지 않는다", async () => {
  // TUI → GUI: 터미널에 TUI가 있는 동안은 query를 열지 않고, foreground가 떠난 뒤에야 연다.
  let foreground: "running" | "shell" = "running";
  let left: (() => void) | undefined;
  const signals: string[] = [];
  const terminal = {
    id: "term_1",
    cwd: "/work/test",
    harness: "claude",
    env: {},
    state: () => foreground,
    sessionId: () => "92f4aba9-f419-4338-aaa4-a04f5146a533",
    type() {},
    signal: (signal: string) => void signals.push(signal),
    onForegroundExit(listener: () => void) {
      left = listener;
      return () => void (left = undefined);
    },
  } as unknown as AcpTerminal;

  const blocked = await setup({ terminal });
  assert.equal(blocked.started.ok, false);
  assert.equal(blocked.queries.length, 0);

  const adapter = blocked.adapter;
  let ended = false;
  const exiting = adapter.exitTui(terminal).then((result) => {
    ended = true;
    return result;
  });
  await flush();
  assert.equal(ended, false);
  assert.ok(signals.length >= 1);
  foreground = "shell";
  left?.();
  assert.equal((await exiting).ok, true);

  const opened = await setup({
    autoExit: false,
    terminal,
    resume: "92f4aba9-f419-4338-aaa4-a04f5146a533",
  });
  assert.equal(opened.started.ok, true);
  assert.equal(opened.queries.length, 1);
  assert.equal(
    opened.queryOptions?.resume,
    "92f4aba9-f419-4338-aaa4-a04f5146a533",
  );

  // GUI → TUI: process가 끝나기 전에는 명령을 내지 않는다.
  assert.ok(opened.started.ok);
  const run = opened.started.value;
  let stopped = false;
  const stopping = run.stop().then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(stopped, false);
  assert.throws(() => run.tuiCommand());
  assert.equal(opened.queries[0]?.closed, true);
  opened.processes[0]?.exit();
  await stopping;
  assert.match(
    run.tuiCommand(),
    /^claude --resume '92f4aba9-f419-4338-aaa4-a04f5146a533'/,
  );
});

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

test("도는 중 보낸 메시지는 CLI 줄에 서고 순서대로 turn이 되며, 지금 보내기는 도는 turn을 멈춘 것으로 닫는다", async () => {
  const t = await setup();
  const rec = recording("steer") as (Entry & { uuid?: string })[];
  const cursor = { at: 0 };
  // 녹화의 순서(A 보내기, B·C 줄 서기, C 빼기, D 지금 보내기)를 따라가며 녹화의 uuid를 실제로 보낸 uuid에 잇는다.
  const step = async (kind: string) => {
    const entry = (
      cursor.at === 0 ? rec[cursor.at++] : await t.play(rec, cursor)
    ) as Entry & { uuid?: string };
    assert.equal(entry.kind, kind);
    return entry;
  };
  const sendRecorded = async (entry: Entry & { uuid?: string }, id: string) => {
    await t.input(t.send(id, textOf(entry)));
    t.rename.set(
      entry.uuid as string,
      t.queries[0]?.sent.at(-1)?.uuid as string,
    );
  };
  await sendRecorded(await step("send"), "1");
  await sendRecorded(await step("send"), "2");
  await sendRecorded(await step("send"), "3");
  assert.deepEqual(
    t.state.queued.map((item) => item.id),
    ["msg_2", "msg_3"],
  );
  assert.deepEqual(
    t.queries[0]?.sent.map((one) => one.priority),
    [undefined, "later", "later"],
  );

  // C를 빼고 D를 지금 보내기로 올린다: 도는 turn A는 멈춘 것으로 끝난다.
  await step("call");
  await t.input({ type: "remove_queued", message: "msg_3" });
  const d = await step("send");
  await t.input(t.send("4", textOf(d)));
  await t.input({ type: "send_queued", message: "msg_4" });
  assert.equal(t.queries[0]?.sent.at(-1)?.priority, "now");
  t.rename.set(d.uuid as string, t.queries[0]?.sent.at(-1)?.uuid as string);
  await t.play(rec, cursor);

  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.id] : [],
  );
  assert.deepEqual(users, ["msg_1", "msg_4", "msg_2"]);
  assert.equal(t.state.queued.length, 0);
  const ends = t.state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );
  assert.deepEqual(ends, ["stopped", "completed", "completed"]);
  assert.equal(t.state.reread, false);
  contiguous(t.state);
});

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

for (const mode of ["default", "acceptEdits", "auto"]) {
  test(`plan 카드에서 어느 mode를 골라도 SDK에 가는 허락은 session에만 거는 setMode 하나뿐이다 (${mode})`, async () => {
    const t = await setup();
    const rec = recording("plan_exit");
    const cursor = { at: 0 };
    await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
    const asked = (await t.play(rec, cursor)) as Entry;
    assert.equal(asked.kind, "can_use_tool");
    const { result } = t.askPermission(asked);
    await flush();

    const approval = t.state.pending.approval;
    assert.equal(approval?.subject.kind, "plan");
    await t.input({
      type: "decide",
      request: approval?.id,
      choice: { kind: "mode", mode },
    });
    const answer = (await result) as {
      behavior: string;
      updatedPermissions?: unknown[];
    };
    assert.equal(answer.behavior, "allow");
    // 사람의 설정 file(localSettings 등)에는 쓰지 않는다.
    assert.deepEqual(answer.updatedPermissions, [
      { type: "setMode", mode, destination: "session" },
    ]);
  });
}

test("resume으로 다시 그린 사람 메시지의 origin은 처음 보낼 때 단 uuid와 같다", async () => {
  const history = JSON.parse(
    readFileSync(`${fixtures}resume-history.json`, "utf8"),
  );
  const t = await setup({
    history,
    resume: "92f4aba9-f419-4338-aaa4-a04f5146a533",
  });
  await flush();
  const user = t.state.items.find(
    (item) => item.kind === "message" && item.actor === "user",
  );
  // transcript의 uuid는 query()에 push한 uuid 그대로다(녹화 origin). 키가 바뀌면 사람의 bookmark를 잃는다.
  assert.equal(
    user?.kind === "message" ? user.origin : null,
    "78fcee1c-e4ec-4dee-be36-96df9a9f7ac0",
  );
});
