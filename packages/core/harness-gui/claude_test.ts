import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  CanUseTool,
  Options,
  SDKUserMessage,
  // biome-ignore lint/correctness/noUndeclaredDependencies: Agent SDK는 extension bundle에만 들어간다. core package.json에 두지 않는다(설치본 platform/이 OS별 claude 사본을 받게 된다).
} from "@anthropic-ai/claude-agent-sdk";
import { manualClock } from "../../base/clock.ts";
import { createIdSource } from "../../base/id.ts";
import { seededRandom } from "../../base/random.ts";
import type { AcpInput } from "../../protocol/acp/input.ts";
import type {
  AcpSessionHandle,
  AcpTerminal,
  CliProcess,
} from "../../protocol/acp/mod.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import type { AcpState, AcpUpdate } from "../../protocol/acp/state.ts";
import {
  type ClaudeSdk,
  claudeDenyTools,
  createClaudeAdapter,
} from "./claude.ts";

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
function fakeProcess(
  command = "",
  args: readonly string[] = [],
  cwd: string | undefined = undefined,
  env: Readonly<Record<string, string>> | undefined = undefined,
) {
  const exits: Array<(code: number | null) => void> = [];
  const outs: Array<(text: string) => void> = [];
  const proc: CliProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {
      made.killed = true;
    },
    onStdout: (listener) => void outs.push(listener),
    onStderr() {},
    onExit: (listener) => void exits.push(listener),
  };
  const made = {
    proc,
    command,
    args,
    cwd,
    env,
    killed: false,
    stdout: (text: string) => outs.forEach((listener) => listener(text)),
    exit: (code = 0) => exits.forEach((listener) => listener(code)),
  };
  return made;
}

async function setup(
  options: {
    history?: unknown[];
    /** transcript의 원본 줄(cost-state 등). */
    entries?: unknown[];
    /** 첫 메시지 전이라 CLI가 저장하지 않은 session. */
    unsaved?: boolean;
    resume?: string;
    terminal?: AcpTerminal | null;
    /** false면 query를 닫아도 process가 끝나지 않는다(test가 `exit()`를 부른다). */
    autoExit?: boolean;
    /** 읽을 수 있는 file(경로 → 글). 나머지는 없다. */
    files?: Record<string, string>;
    models?: unknown[];
    /** getContextUsage가 말하는 resolved model. */
    contextModel?: string;
    /** interrupt·setPermissionMode에 CLI가 답하지 않는다. */
    hang?: boolean;
    /** 두 번째부터의 query는 메시지 없이 끝나거나(`true`) query()가 바로 던진다(`"throw"`). 새 CLI가 뜨지 못함. */
    emptyReopen?: boolean | "throw";
    /** lophn 팀원 탭이다. */
    member?: { deny: readonly string[] };
    launch?: { model?: string; options?: Record<string, string> };
    carry?: { model?: string; effort?: string };
    args?: readonly string[];
    /** getSessionInfo가 돌려줄 metadata. */
    sessionInfo?: () => {
      customTitle?: string;
      firstPrompt?: string;
      summary: string;
    };
  } = {},
) {
  const sdkMessages: unknown[] = [];
  let wake: (() => void) | undefined;
  const queries: Fake[] = [];
  const processes: ReturnType<typeof fakeProcess>[] = [];
  // 옛 session의 transcript를 바꾸는 SDK 호출. open_session은 이것을 부르면 안 된다.
  const calls: string[] = [];
  const backgrounded: string[] = [];
  let interrupts = 0;
  const never = () => new Promise<never>(() => {});
  const spawn = (
    command: string,
    args: readonly string[],
    spawnOptions?: { cwd?: string; env?: Readonly<Record<string, string>> },
  ) => {
    const made = fakeProcess(
      command,
      args,
      spawnOptions?.cwd,
      spawnOptions?.env,
    );
    processes.push(made);
    return made.proc;
  };
  const sdk = {
    query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
      const fake: Fake = { options: params.options, sent: [], closed: false };
      queries.push(fake);
      const reopened = queries.length > 1;
      if (options.emptyReopen === "throw" && reopened)
        throw new Error("spawn failed");
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
          if (options.emptyReopen && reopened) return;
          for (;;) {
            const next = sdkMessages.shift();
            if (next instanceof Error) throw next;
            if (next !== undefined) yield next;
            else await new Promise<void>((resolve) => (wake = resolve));
          }
        },
        interrupt() {
          interrupts++;
          return options.hang ? never() : Promise.resolve();
        },
        setPermissionMode: () => (options.hang ? never() : Promise.resolve()),
        close() {
          fake.closed = true;
          if (options.autoExit !== false) processes.at(-1)?.exit();
        },
        supportedModels: () => Promise.resolve(options.models ?? []),
        supportedCommands: () => Promise.resolve([]),
        getContextUsage: () =>
          Promise.resolve({
            totalTokens: 1,
            maxTokens: 2,
            model: options.contextModel ?? "m",
            categories: [],
          }),
        cancelAsyncMessage: () => Promise.resolve(true),
        backgroundTasks: (id?: string) => {
          backgrounded.push(id ?? "");
          return Promise.resolve(true);
        },
        rewindFiles: () => {
          calls.push("rewindFiles");
          return Promise.resolve({ canRewind: true });
        },
      };
    },
    getSessionMessages: () => Promise.resolve(options.history ?? []),
    getSubagentMessages: () => Promise.resolve([]),
    getSessionInfo: (id: string) =>
      Promise.resolve(
        options.unsaved
          ? undefined
          : {
              sessionId: id,
              lastModified: 0,
              ...(options.sessionInfo?.() ?? { summary: "" }),
            },
      ),
    importSessionToStore: async (
      _id: string,
      store: { append(key: object, entries: unknown[]): Promise<void> },
    ) => {
      await store.append({}, options.entries ?? []);
    },
    forkSession: () => {
      calls.push("forkSession");
      return Promise.resolve({ sessionId: "forked" });
    },
    renameSession: () => {
      calls.push("renameSession");
      return Promise.resolve();
    },
    readFile: (path: string) => {
      const text = options.files?.[path];
      return text === undefined
        ? Promise.reject(new Error("no such file"))
        : Promise.resolve(new TextEncoder().encode(text));
    },
    userDir: "/home/me/.claude",
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
    ...(options.member === undefined ? {} : { member: options.member }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    ...(options.carry === undefined ? {} : { carry: options.carry }),
    ...(options.args === undefined ? {} : { args: options.args }),
    session,
    spawn,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });

  return {
    adapter,
    spawn,
    started,
    queries,
    processes,
    calls,
    backgrounded,
    clock,
    get interrupts() {
      return interrupts;
    },
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
    /** SDK의 message 흐름이 이 오류로 끝난다(CLI가 죽은 것). */
    async fail(error: Error) {
      sdkMessages.push(error);
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
  const history: unknown[] = [];
  const t = await setup({ history });
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
  // rewind는 transcript에서 그 메시지를 찾는다(못 찾으면 아무것도 하지 않는다).
  history.push({
    type: "user",
    uuid: userMessage.uuid,
    message: { role: "user", content: "touch one.txt" },
  });
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

// foreground tool이 도는 동안 줄에 선 메시지는 tool이 끝날 때까지 CLI가 읽지 않는다. desktop처럼 tool_use id로 background에 보낸다(녹화 steer_detach).
async function startBash(t: Awaited<ReturnType<typeof setup>>) {
  await t.input(t.send("1", "run it"));
  await t.feed({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "Bash",
          input: { command: "sleep 99" },
        },
      ],
    },
  });
}

test("steer는 3초 돈 Bash를 tool_use id로 background에 보내고 next_turn은 건드리지 않는다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = await setup();
    await startBash(t);
    await t.input(t.send("2", "later one"));
    await t.input({ ...t.send("3", "steer"), delivery: "steer" });
    assert.deepEqual(t.backgrounded, []);
    t.clock.advance(3000);
    mock.timers.tick(1000);
    assert.deepEqual(t.backgrounded, ["tu_1"]);
    mock.timers.tick(5000);
    assert.deepEqual(t.backgrounded, ["tu_1"]);
  } finally {
    mock.timers.reset();
  }
});

test("background_tool은 3초를 기다리지 않고 도는 Bash를 tool_use id로 background에 보낸다", async () => {
  const t = await setup();
  await startBash(t);
  await t.input({ type: "background_tool", key: "bg_1" });
  assert.deepEqual(t.backgrounded, ["tu_1"]);
});

test("지금 보내기는 도는 Bash를 바로 tool_use id로 background에 보낸다", async () => {
  const t = await setup();
  await startBash(t);
  await t.input(t.send("2", "later one"));
  await t.input({ type: "send_queued", message: "msg_2" });
  assert.deepEqual(t.backgrounded, ["tu_1"]);
  assert.equal(t.queries[0]?.sent.at(-1)?.priority, "now");
});

const result = (user: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  user_message_uuid: user,
  usage: {},
});

// 줄 선 later 여럿이 한 turn으로 묶여 started가 잇따라 오면 모두 steer로 보였다(고친 뒤 다시 깨진 적 있다).
test("줄 선 later 메시지가 잇따라 시작해도 steer가 아니라 첫 메시지가 연 turn의 next_turn이다", async () => {
  const t = await setup();
  await t.input(t.send("1", "first"));
  await t.input(t.send("2", "second"));
  await t.input(t.send("3", "third"));
  const [, second, third] = t.queries[0]?.sent ?? [];
  await t.feed(result("x"));
  for (const one of [second, third])
    await t.feed({
      type: "command_lifecycle",
      command_uuid: one?.uuid,
      state: "started",
    });
  const taken = (id: string) => {
    const found = t.state.items.find(
      (item) => item.kind === "message" && item.id === id,
    );
    assert.equal(found?.kind, "message");
    return found?.kind === "message" ? found : undefined;
  };
  assert.equal(taken("msg_2")?.delivery, "next_turn");
  assert.equal(taken("msg_3")?.delivery, "next_turn");
  assert.notEqual(taken("msg_2")?.turn, taken("msg_1")?.turn);
  assert.equal(taken("msg_3")?.turn, taken("msg_2")?.turn);
});

test("steer 메시지를 고치거나 옮겨 다시 세워도 priority가 later로 내려가지 않는다", async () => {
  const t = await setup();
  await t.input(t.send("1", "first"));
  await t.input({ ...t.send("2", "steer"), delivery: "steer" });
  await t.input({
    type: "edit_queued",
    message: "msg_2",
    content: [{ type: "text", text: "steer edited" }],
  });
  assert.equal(t.queries[0]?.sent.at(-1)?.priority, "next");
});

// 현재 CLI는 run_in_background 없이도 Agent를 비동기로 띄워 tool 결과가 바로 오고 끝은 task 알림이 알린다. 줄이 done이 되면 running 카드에서 빠졌다.
test("비동기로 띄운 Agent는 tool 결과와 turn 끝 뒤에도 task 알림이 끝낼 때까지 running이다", async () => {
  const t = await setup();
  await t.input(t.send("1", "go"));
  await t.feed({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu_agent",
          name: "Agent",
          input: { description: "d", prompt: "p" },
        },
      ],
    },
  });
  await t.feed({
    type: "system",
    subtype: "task_started",
    task_id: "a1",
    tool_use_id: "tu_agent",
    description: "d",
  });
  await t.feed({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_agent", content: "launched" },
      ],
    },
    tool_use_result: { status: "async_launched", agentId: "a1" },
  });
  await t.feed(result("x"));
  const stateOf = () => {
    const found = t.state.items.find(
      (item) => item.kind === "tool" && item.tool === "Agent",
    );
    return found?.kind === "tool"
      ? (found.detail as { state?: string } | null)?.state
      : undefined;
  };
  assert.equal(stateOf(), "running");
  await t.feed({
    type: "system",
    subtype: "task_notification",
    task_id: "a1",
    tool_use_id: "tu_agent",
    status: "completed",
    summary: "finished",
  });
  assert.equal(stateOf(), "done");
});

// `!` 명령이 model prompt로 새면 사람이 친 shell 명령을 model이 지시로 받는다(녹화 shell_append: shouldQuery false는 turn을 열지 않는다).
test("`!`와 run_shell은 shouldQuery false 메시지만 input queue에 넣고, 도는 turn이 있으면 그 turn이 끝난 뒤에 넣는다", async () => {
  const t = await setup();
  const sent = () => t.queries[0]?.sent ?? [];
  const shells = () => t.processes.filter((one) => one.command === "/bin/sh");

  // 글이 `!`로 시작하는 send도 model에 가지 않는다.
  await t.input({ type: "run_shell", key: "a", command: "ls" });
  await t.input(t.send("1", "!echo hi"));
  assert.deepEqual(
    shells().map((one) => one.args[1]?.split("\n")[0]),
    ["ls", "echo hi"],
  );
  assert.equal(sent().length, 0);
  shells()[0]?.stdout("a.txt\n");
  shells()[0]?.exit();
  await flush();

  assert.deepEqual(
    sent().map((one) => [one.message.content, one.shouldQuery]),
    [
      ["<bash-input>ls</bash-input>", false],
      ["<bash-stdout>a.txt\n</bash-stdout><bash-stderr></bash-stderr>", false],
    ],
  );
  assert.ok(sent().every((one) => one.client_composed === true));
  const first = tools(t.state)[0];
  assert.equal(first?.by, "user");
  assert.equal(first?.state, "ok");
  assert.equal(first?.body?.output, "a.txt\n");
  // 그 result(num_turns 0)는 turn이 아니다. 사람 말풍선도 만들지 않는다.
  await t.feed({ ...result(sent()[0]?.uuid ?? ""), num_turns: 0 });
  assert.equal(t.state.turn, null);
  assert.equal(
    t.state.items.some((item) => item.kind === "message"),
    false,
  );

  // 도는 turn 동안은 끝난 결과도 줄에 넣지 않는다.
  await t.input(t.send("2", "hello"));
  const turnUuid = sent().at(-1)?.uuid ?? "";
  shells()[1]?.exit();
  await flush();
  assert.equal(sent().length, 3);
  await t.feed(result(turnUuid));
  assert.equal(sent().length, 5);
  assert.ok(
    sent()
      .slice(3)
      .every((one) => one.shouldQuery === false),
  );
});

// stop이 아니라 stop_shell이 다른 명령까지 죽이면 사람이 돌려 둔 build 같은 긴 명령이 같이 사라진다.
test("stop_shell은 그 줄의 명령만 죽이고 그 줄을 cancelled로 닫는다", async () => {
  const t = await setup();
  const shells = () => t.processes.filter((one) => one.command === "/bin/sh");
  await t.input({ type: "run_shell", key: "a", command: "sleep 1" });
  await t.input({ type: "run_shell", key: "b", command: "sleep 2" });
  const [first, second] = tools(t.state);

  await t.input({ type: "stop_shell", item: first?.id ?? "" });
  assert.deepEqual(
    shells().map((one) => one.killed),
    [true, false],
  );
  shells()[0]?.exit(143);
  await flush();
  assert.deepEqual(
    tools(t.state).map((one) => one.state),
    ["cancelled", "running"],
  );
  assert.equal(second?.id, tools(t.state)[1]?.id);
});

// open_session이 옛 session을 fork·rewind·rename하면 사람이 열어 둔 대화가 바뀐다.
test("open_session은 지금 session의 transcript를 바꾸는 SDK 호출 없이 고른 id로 resume한 새 query를 열고 bash 기록을 shell 줄로 다시 그린다", async () => {
  const history = JSON.parse(
    readFileSync(`${fixtures}shell-history.json`, "utf8"),
  );
  const t = await setup({ history });
  await t.input({ type: "open_session", key: "k", cli_session: "other-id" });
  await flush();

  assert.equal(t.queries.length, 2);
  assert.equal(t.queries[0]?.closed, true);
  assert.equal(t.queryOptions?.resume, "other-id");
  assert.deepEqual(t.calls, []);

  const user = tools(t.state)[0];
  assert.equal(user?.by, "user");
  assert.equal(user?.title, "ls");
  assert.equal(user?.body?.output, "hello.txt\n");
  const texts = t.state.items.flatMap((item) =>
    item.kind === "message" ? [item.actor] : [],
  );
  assert.deepEqual(texts, ["user"]);
  assert.equal(t.state.reread, false);
});

// 명령마다 새 shell이라, 끝난 cwd를 이어 주지 않으면 `!cd sub` 뒤의 `!ls`가 원래 폴더에서 돈다.
test("`!`는 앞 명령이 끝난 cwd에서 돌고 그 표시는 출력에 남지 않는다", async () => {
  const t = await setup();
  const shells = () => t.processes.filter((one) => one.command === "/bin/sh");

  await t.input({ type: "run_shell", key: "a", command: "cd sub && ls" });
  assert.equal(shells()[0]?.cwd, "/work/test");
  shells()[0]?.stdout("a.txt");
  shells()[0]?.stdout("\n:lophn-cwd:/work/te");
  shells()[0]?.stdout("st/sub\n");
  shells()[0]?.exit();
  await flush();
  assert.equal(tools(t.state)[0]?.body?.output, "a.txt");

  await t.input({ type: "run_shell", key: "b", command: "ls" });
  assert.equal(shells()[1]?.cwd, "/work/test/sub");
});

// CLI가 끝난 뒤 보낸 메시지가 실패로 끝나기만 하면 사람은 TUI로 넘겼다 와야 이어 간다.
test("CLI가 끝난 뒤의 send는 같은 session id로 query를 다시 열어 그 메시지를 넣고, 못 열면 실패한 turn으로 끝난다", async () => {
  const t = await setup({ resume: "resumed-id" });
  const errors = () =>
    t.state.items.flatMap((item) =>
      item.kind === "notice" && item.notice.type === "error"
        ? [item.notice.message]
        : [],
    );
  await t.fail(new Error("boom"));
  assert.deepEqual(errors(), ["boom"]);

  await t.input(t.send("1", "again"));
  assert.equal(t.queries.length, 2);
  assert.equal(t.queryOptions?.resume, "resumed-id");
  assert.equal(
    t.queries[1]?.sent.map((one) => one.message.content).join(""),
    "again",
  );
  assert.equal(t.state.turn?.phase, "working");

  // 다시 죽으면 그 turn이 이유와 함께 실패로 닫힌다.
  await t.fail(new Error("boom again"));
  assert.equal(t.state.turn?.phase, "ended");
  assert.deepEqual(errors(), ["boom", "boom again"]);
  await t.input({ type: "open_session", key: "k", cli_session: "resumed-id" });
  assert.equal(t.queries.length, 3);
});

// 합계가 0부터 다시 세면 앞 대화의 비용을 잃는다. resume한 CLI의 total_cost_usd는 session 누적이라 더하지 않고 바꾼다.
test("resume은 transcript의 cost-state로 합계와 비용을 되살리고 이어 오는 result의 누적 비용에 겹치지 않는다", async () => {
  const history = JSON.parse(
    readFileSync(`${fixtures}resume-history.json`, "utf8"),
  );
  const t = await setup({
    history,
    resume: "92f4aba9-f419-4338-aaa4-a04f5146a533",
    entries: [
      { type: "cost-state", totalCostUSD: 9, modelUsage: { old: {} } },
      {
        type: "cost-state",
        totalCostUSD: 0.5,
        modelUsage: {
          a: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadInputTokens: 30,
            cacheCreationInputTokens: 40,
          },
          b: { inputTokens: 1, outputTokens: 2 },
        },
      },
    ],
  });
  await flush();
  const usage = () => t.state.session?.usage;
  assert.deepEqual(
    [usage()?.input_tokens, usage()?.output_tokens, usage()?.cache_read_tokens],
    [11, 22, 30],
  );
  assert.equal(usage()?.cache_write_tokens, 40);
  assert.equal(usage()?.turns, 1);
  assert.equal(usage()?.costs[0]?.amount, "0.5000");

  await t.feed({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.75,
    usage: { input_tokens: 5, output_tokens: 5 },
  });
  assert.equal(usage()?.costs[0]?.amount, "0.7500");
  assert.equal(usage()?.input_tokens, 16);
});

// 첫 메시지 전의 session은 CLI가 저장하지 않아 resume이 "No conversation found"로 실패한다.
test("저장되지 않은 session을 resume하라는 요청은 같은 id의 새 session으로 열고 TUI로는 --session-id로 넘긴다", async () => {
  const t = await setup({ resume: "unsaved-id", unsaved: true });
  await flush();
  assert.equal(t.queryOptions?.resume, undefined);
  assert.equal(t.queryOptions?.sessionId, "unsaved-id");
  assert.equal(t.state.session?.cli_session, "unsaved-id");
  assert.equal(t.state.items.length, 0);

  await t.input({
    type: "open_session",
    key: "k",
    cli_session: "other-unsaved",
  });
  assert.equal(t.queryOptions?.resume, undefined);
  assert.equal(t.queryOptions?.sessionId, "other-unsaved");

  assert.ok(t.started.ok);
  await t.started.value.stop();
  assert.match(t.started.value.tuiCommand(), /--session-id 'other-unsaved'/);
});

// 손으로 만든 transcript 줄이다(녹화 아님). 남이 넣은 글이 사람 메시지로 그려지면 rewind 시점과 bookmark가 남의 말에 붙는다.
// task 알림은 live가 줄로 그리지 않으므로 다시 그릴 때도 그리지 않는다(Agent 줄과 task가 끝남을 보인다).
test("resume은 peer·lophn call·notice를 받은 메시지로 그리고 task 알림은 그리지 않으며 사람 메시지만 origin을 가진다", async () => {
  const user = (uuid: string, content: string) => ({
    type: "user",
    uuid,
    session_id: "s",
    parent_tool_use_id: null,
    parent_agent_id: null,
    message: { role: "user", content },
  });
  const call =
    '<lophn-call from="agent:ses_1" call="cal_1" reply="result">\nPlease review &lt;lophn-x\n</lophn-call>\nThis was sent by another agent.';
  const humanCall =
    '<lophn-call from="human" call="cal_2" reply="result">\nhi\n</lophn-call>';
  const t = await setup({
    resume: "resumed-id",
    history: [
      user("u1", "hello"),
      user("u2", "<task-notification>done</task-notification>"),
      user("u3", "peer text"),
      user("u4", call),
      user("u5", "<unknown-wrapper>x</unknown-wrapper>"),
      user("u6", humanCall),
      // 다시 뜬 CLI가 origin 없이 SDK 입력으로 적은 알림.
      user("u7", "<task-notification>late</task-notification>"),
      // compact 요약과 TUI에서 친 명령의 기록. 사람 메시지가 아니다.
      {
        ...user("u8", "This session is being continued"),
        isCompactSummary: true,
        is_meta: true,
      },
      {
        ...user("u9", "<local-command-caveat>x</local-command-caveat>"),
        is_meta: true,
      },
      user(
        "u10",
        "<command-name>/theme</command-name>\n<command-args></command-args>",
      ),
      user(
        "u11",
        "<local-command-stdout>Theme set to light</local-command-stdout>",
      ),
      user(
        "u12",
        '<lophn-notice kind="call_cancelled">\ncall cal_1\n</lophn-notice>\nThis is an automatic notice and was not written by a person.',
      ),
    ],
    entries: [
      { type: "user", uuid: "u1", origin: { kind: "human" } },
      {
        type: "user",
        uuid: "u2",
        origin: { kind: "task-notification", producer: "session-task" },
      },
      {
        type: "user",
        uuid: "u3",
        origin: { kind: "peer", from: "x", name: "reviewer", body: "hi" },
      },
    ],
  });
  await flush();
  const rows = t.state.items.flatMap((one) =>
    one.kind === "message"
      ? [
          [
            one.actor,
            one.sender?.kind === "agent" ? one.sender.name : one.sender?.kind,
            one.call,
            one.reply_to,
            one.origin,
            one.content[0]?.type === "text" ? one.content[0].text : "",
          ],
        ]
      : [],
  );
  assert.deepEqual(rows, [
    ["user", undefined, null, null, "u1", "hello"],
    ["received", "reviewer", null, null, null, "hi"],
    ["received", "agent:ses_1", "cal_1", null, null, "Please review <lophn-x"],
    [
      "user",
      undefined,
      null,
      null,
      "u5",
      "<unknown-wrapper>x</unknown-wrapper>",
    ],
    ["user", undefined, null, null, "u6", humanCall],
    ["received", "program", null, null, null, "call cal_1"],
  ]);
  assert.ok(
    t.state.items.some(
      (one) =>
        one.kind === "notice" &&
        one.notice.type === "command_output" &&
        one.notice.command === "theme" &&
        one.notice.text === "Theme set to light",
    ),
  );
});

// 사람의 설정이 auto인데 첫 turn 전까지 "Ask before edits"로 보였다.
test("첫 turn 전의 mode는 설정 file 셋을 뒤가 이기게 읽은 값이고, init이 오면 그것이 이긴다", async () => {
  const mode = (value: string) =>
    JSON.stringify({ permissions: { defaultMode: value } });
  const t = await setup({
    files: {
      "/home/me/.claude/settings.json": mode("plan"),
      "/work/test/.claude/settings.json": mode("auto"),
      "/work/test/.claude/settings.local.json": "{ broken",
    },
  });
  assert.equal(t.state.session?.mode, "auto");
  assert.equal(t.queryOptions?.permissionMode, undefined);
  await t.feed({
    type: "system",
    subtype: "init",
    permissionMode: "acceptEdits",
  });
  assert.equal(t.state.session?.mode, "acceptEdits");
});

test("Default model 줄은 resolved model의 이름으로 보이고 고르는 값은 default 그대로다", async () => {
  const row = (value: string, displayName: string, resolvedModel: string) => ({
    value,
    displayName,
    description: "",
    resolvedModel,
  });
  const t = await setup({
    models: [
      row("default", "Default (recommended)", "claude-opus-5"),
      row("opus", "Opus", "claude-opus-5"),
    ],
    contextModel: "claude-opus-5",
  });
  await flush();
  assert.equal(t.state.session?.model?.model, "default");
  assert.equal(t.state.session?.model?.label, "Opus");
});

// subagent가 띄운 background task의 알림이 root 대화에 회색 줄로 섞여 보였다. Agent 줄은 task_started부터 시간을 센다.
test("subagent 안에서 띄운 task는 root에 알림을 내지 않고 Agent 줄은 task_started에 선다", async () => {
  const t = await setup();
  await t.input(t.send("1", "go"));
  const use = (
    id: string,
    name: string,
    input: object,
    parent: string | null,
  ) =>
    t.feed({
      type: "assistant",
      parent_tool_use_id: parent,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name, input }],
      },
    });
  const infos = () =>
    t.state.items.flatMap((item) =>
      item.kind === "notice" && item.notice.type === "info"
        ? [item.notice.text]
        : [],
    );
  const tools = () => t.state.items.filter((item) => item.kind === "tool");
  await use("tu_agent", "Agent", { description: "d", prompt: "p" }, null);
  assert.equal(tools().length, 0);
  await t.feed({
    type: "system",
    subtype: "task_started",
    task_id: "a1",
    tool_use_id: "tu_agent",
    description: "d",
  });
  assert.equal(tools().length, 1);
  await use(
    "tu_bash",
    "Bash",
    { command: "sleep 9", run_in_background: true },
    "tu_agent",
  );
  await t.feed({
    type: "system",
    subtype: "task_started",
    task_id: "b1",
    tool_use_id: "tu_bash",
    description: "child bash",
  });
  await t.feed({
    type: "system",
    subtype: "task_notification",
    task_id: "b1",
    status: "completed",
    summary: "child bash done",
  });
  await t.feed({
    type: "system",
    subtype: "task_started",
    task_id: "r1",
    description: "root bash",
  });
  assert.deepEqual(infos(), ["Started: root bash"]);
});

test("고르지 않은 effort는 init이나 설정 file의 값을 보이고, 고른 값은 건드리지 않는다", async () => {
  const model = {
    value: "default",
    displayName: "Default",
    description: "",
    resolvedModel: "claude-opus-5",
    supportsEffort: true,
    supportedEffortLevels: ["low", "high", "xhigh"],
  };
  const t = await setup({
    models: [model],
    contextModel: "claude-opus-5",
    files: {
      "/home/me/.claude/settings.json": JSON.stringify({ effortLevel: "low" }),
      "/work/test/.claude/settings.local.json": JSON.stringify({
        effortLevel: "high",
        modelSettings: { default: { effortLevel: "xhigh" } },
      }),
    },
  });
  await flush();
  assert.equal(t.state.session?.model?.options.effort, "xhigh");
  await t.feed({ type: "system", subtype: "init", effort: "low" });
  assert.equal(t.state.session?.model?.options.effort, "low");
  await t.feed({ type: "system", subtype: "init", effort: null });
  assert.equal(t.state.session?.model?.options.effort, undefined);
});

// 두 번 고친 것: SDK 값 그대로 event마다 떴고, 한도가 넉넉해도(서버의 낮은 문턱) 떴다.
test("사용 한도 warning은 TUI처럼 70%부터, 창마다 단계가 바뀔 때 한 번만 뜬다", async () => {
  const t = await setup({});
  const event = (utilization: number, status: string) => ({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      rateLimitType: "five_hour",
      unifiedWindows: {
        five_hour: {
          utilization: 0.1,
          resetsAt: 1794080400,
          status: "allowed",
        },
        seven_day: { utilization, resetsAt: 1794636000, status },
      },
    },
  });
  await t.feed(event(0.3, "allowed_warning"));
  await t.feed(event(0.71, "allowed_warning"));
  await t.feed(event(0.72, "allowed_warning"));
  await t.feed(event(1, "rejected"));
  const warnings = t.state.items.flatMap((one) =>
    one.kind === "notice" && one.notice.type === "info"
      ? [one.notice.text]
      : [],
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /^You've used 71% of your weekly limit\./);
  assert.match(warnings[1] ?? "", /^You've hit your weekly limit\./);
});

// 두 번 고친 것: `/compact` 출력이 색 code와 hook 글을 단 채 명령 출력으로 그려졌다.
test("명령 출력은 색 code를 떼고 `/compact` 출력은 그리지 않는다", async () => {
  const t = await setup({});
  await t.feed({
    type: "system",
    subtype: "local_command_output",
    content:
      "\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m PostCompact [$HOME]",
  });
  await t.feed({
    type: "system",
    subtype: "local_command_output",
    content: "\u001b[1mTheme set\u001b[22m",
  });
  const notices = t.state.items.flatMap((one) =>
    one.kind === "notice" ? [one.notice] : [],
  );
  assert.deepEqual(
    notices.map((one) => ("text" in one ? one.text : "")),
    ["Theme set"],
  );
});

const infos = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "info"
      ? [item.notice.text]
      : [],
  );

// 앞 입력(set_mode)이 답 없는 CLI를 기다리면 줄이 멈춘다. Stop과 승인 답까지 거기 서면 사람이 끌 수 없다.
test("앞 입력이 CLI 답을 기다리는 동안에도 Stop과 승인 답은 바로 처리된다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = await setup({ hang: true });
    const rec = recording("write_approval");
    const cursor = { at: 0 };
    await t.input(t.send("1", textOf(rec[cursor.at++] as Entry)));
    const asked = (await t.play(rec, cursor)) as Entry;
    const { result } = t.askPermission(asked);
    await flush();
    const approval = t.state.pending.approval;
    assert.ok(approval);

    await t.input({ type: "set_mode", mode: "plan" });
    await t.input({
      type: "decide",
      request: approval.id,
      choice: { kind: "once" },
    });
    assert.equal(t.state.pending.approval, null);
    assert.equal(((await result) as { behavior: string }).behavior, "allow");

    await t.input({ type: "stop" });
    assert.equal(t.interrupts, 1);

    // 기한이 지나면 줄이 풀리고 실패가 사람에게 보인다.
    mock.timers.tick(30_000);
    await flush();
    assert.ok(
      infos(t.state).some((text) => text.startsWith("set_mode failed:")),
    );
  } finally {
    mock.timers.reset();
  }
});

for (const mode of [true, "throw"] as const) {
  test(`rewind로 연 새 CLI가 메시지 없이 끝나면 다음 send와 TUI 명령은 앞 session id를 쓰고 숨긴 구간이 되살아난다 (${mode === true ? "empty" : "query throws"})`, async () => {
    const options: Parameters<typeof setup>[0] = { emptyReopen: mode };
    const t = await setup(options);
    assert.ok(t.started.ok);
    const run = t.started.value;
    const before = run.sessionId();
    await t.input(t.send("1", "hello"));
    const uuid = t.queries[0]?.sent[0]?.uuid;
    // 손으로 만든 transcript다(녹화 아님). rewind가 사람 메시지 uuid를 여기서 찾는다.
    options.history = [{ type: "user", uuid, message: { content: "hello" } }];

    await t.input({ type: "rewind", message: "msg_1", files: false });
    await flush();
    assert.equal(t.queries.length, 2);
    assert.equal(run.sessionId(), before);
    assert.equal(
      t.state.items.some((item) => item.kind === "hidden"),
      false,
    );
    assert.ok(
      t.state.items.some(
        (item) => item.kind === "message" && item.id === "msg_1",
      ),
    );
    assert.ok(
      infos(t.state).some((text) => text.startsWith("Rewind did not happen")),
    );

    await t.input(t.send("2", "again"));
    assert.equal(t.queryOptions?.resume, before);
    await run.stop();
    assert.match(run.tuiCommand(), new RegExp(`^claude --resume '${before}'`));
  });
}

test("interrupt에 답하지 않는 CLI도 stop()이 3초 뒤 query를 닫고 끝난다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = await setup({ hang: true });
    assert.ok(t.started.ok);
    await t.input(t.send("1", "run it"));
    let done = false;
    const stopping = t.started.value.stop().then(() => (done = true));
    await flush();
    assert.equal(t.queries[0]?.closed, false);
    mock.timers.tick(3000);
    await stopping;
    assert.equal(done, true);
    assert.equal(t.queries[0]?.closed, true);
  } finally {
    mock.timers.reset();
  }
});

test("세션 제목은 SDK summary(lastPrompt)보다 firstPrompt를 먼저 쓰고 customTitle이 생기면 갱신한다", async () => {
  let info: { customTitle?: string; firstPrompt?: string; summary: string } = {
    firstPrompt: "First prompt",
    summary: "Last prompt after second turn",
  };
  const t = await setup({ sessionInfo: () => info });
  await t.input(t.send("1", "First prompt"));
  await t.feed({ type: "result", subtype: "success", is_error: false });
  await flush();
  assert.equal(t.state.session?.title, "First prompt");

  info = {
    customTitle: "AI Generated Title",
    firstPrompt: "First prompt",
    summary: "AI Generated Title",
  };
  await t.input(t.send("2", "Second prompt"));
  await t.feed({ type: "result", subtype: "success", is_error: false });
  await flush();
  assert.equal(t.state.session?.title, "AI Generated Title");
});

test("lophn 봉투로 싼 firstPrompt는 봉투를 벗긴 본문 첫 줄이 제목이 되고 customTitle이 생기면 그쪽으로 갱신한다", async () => {
  let info: { customTitle?: string; firstPrompt?: string; summary: string } = {
    firstPrompt:
      '<lophn-call from="agent:ses_x" call="cal_1" reply="result">\nResearch the pricing page\nmore detail',
    summary: '<lophn-step instance="wfi_1" step="research">\nStep body',
  };
  const t = await setup({ sessionInfo: () => info });
  await t.input(t.send("1", "x"));
  await t.feed({ type: "result", subtype: "success", is_error: false });
  await flush();
  assert.equal(t.state.session?.title, "Research the pricing page");

  // 닫는 tag 없이 잘린 firstPrompt와 summary의 step 봉투도 같다.
  info = {
    firstPrompt: '<lophn-call from="agent:ses_x" call="cal_1">',
    summary: '<lophn-step instance="wfi_1" step="research">\nStep body',
  };
  await t.input(t.send("2", "y"));
  await t.feed({ type: "result", subtype: "success", is_error: false });
  await flush();
  assert.equal(t.state.session?.title, "Step body");

  info = {
    customTitle: "AI title",
    firstPrompt: info.firstPrompt,
    summary: "",
  };
  await t.input(t.send("3", "z"));
  await t.feed({ type: "result", subtype: "success", is_error: false });
  await flush();
  assert.equal(t.state.session?.title, "AI title");
});

// 팀원 탭의 `!`는 사람이 친 명령이다. turn 자격 file 경로를 비운 env로 띄워 `!lophn …`이 사람 자격으로 돈다. 팀원 탭은 `lophn`을 부를
// Bash를 허락하고 정의의 deny를 막는다.
test("a member tab's `!` runs with the turn credential file cleared, and the CLI may run lophn but not the denied commands", async () => {
  const member = await setup({
    member: { deny: ["lophn(myapp deploy)"] },
  });
  await member.input(member.send("1", "!lophn tab open --url https://x"));
  const shell = member.processes.find((one) => one.command === "/bin/sh");
  assert.deepEqual(shell?.env, { LOPHN_AGENT_CREDENTIAL_FILE: "" });
  const options = member.queries[0]?.options;
  assert.ok(options?.allowedTools?.includes("Bash(lophn *)"));
  assert.deepEqual(options?.disallowedTools, [
    "Bash(lophn myapp deploy)",
    "Bash(lophn myapp deploy *)",
  ]);

  const person = await setup();
  await person.input(person.send("1", "!ls"));
  const plain = person.processes.find((one) => one.command === "/bin/sh");
  assert.equal(plain?.env, undefined);
  assert.equal(person.queries[0]?.options.allowedTools, undefined);
});

test("launch는 model·effort·fast를 SDK 옵션으로 넘기고 args와 carry가 launch보다 앞선다", async () => {
  const launched = await setup({
    launch: { model: "opus", options: { effort: "high", fast: "on" } },
  });
  assert.equal(launched.queryOptions?.model, "opus");
  assert.equal(launched.queryOptions?.effort, "high");
  assert.deepEqual(launched.queryOptions?.settings, { fastMode: true });

  const off = await setup({ launch: { options: { effort: "off" } } });
  assert.equal(off.queryOptions?.effort, undefined);
  assert.deepEqual(off.queryOptions?.thinking, { type: "disabled" });

  const carried = await setup({
    launch: { model: "opus", options: { effort: "high" } },
    carry: { model: "sonnet", effort: "low" },
  });
  assert.equal(carried.queryOptions?.model, "sonnet");
  assert.equal(carried.queryOptions?.effort, "low");

  const flagged = await setup({
    launch: { model: "opus", options: { effort: "high" } },
    carry: { model: "sonnet", effort: "low" },
    args: ["--model", "haiku", "--effort", "max"],
  });
  assert.equal(flagged.queryOptions?.model, "haiku");
  assert.equal(flagged.queryOptions?.effort, "max");
});

test("fetchCatalog는 메시지 없이 model 목록과 설정의 기본값을 읽고 query를 닫는다", async () => {
  const t = await setup({
    models: [
      {
        value: "default",
        displayName: "Default",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
    ],
    files: {
      "/home/me/.claude/settings.json": JSON.stringify({
        model: "opus",
        effortLevel: "high",
      }),
    },
  });
  const before = t.queries.length;
  const result = await t.adapter.fetchCatalog({
    cwd: "/work/test",
    spawn: t.spawn,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.defaults, {
    model: "opus",
    options: { effort: "high" },
  });
  assert.equal(result.value.models[0]?.models[0]?.id, "default");
  const probe = t.queries[before];
  assert.ok(probe);
  assert.equal(probe.options.persistSession, false);
  assert.deepEqual(probe.sent, []);
  assert.equal(probe.closed, true);

  const cancelled = new AbortController();
  cancelled.abort();
  const stopped = await t.adapter.fetchCatalog({
    spawn: t.spawn,
    signal: cancelled.signal,
  });
  assert.equal(stopped.ok, false);
  assert.equal(t.queries.at(-1)?.closed, true);
});

test("claudeDenyTools는 lophn(<cmd>)만 Bash disallow 목록으로 옮기고 알 수 없는 규칙은 null을 낸다", () => {
  assert.deepEqual(claudeDenyTools(["lophn(notes remove)"]), [
    "Bash(lophn notes remove)",
    "Bash(lophn notes remove *)",
  ]);
  assert.equal(claudeDenyTools(["Bash(rm *)"]), null);
});
