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
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import { type CodexLink, createCodexAdapter } from "./codex.ts";

// 녹화(fixtures/codex, 실제 codex 0.166.0이 낸 줄을 scrub한 것)로 adapter를 돌린다. 실제 codex는 띄우지 않는다. 가짜 link가
// 녹화의 `recv` 줄을 내보내고 adapter가 쓴 줄을 모은다. startup.jsonl은 initialize부터 skills/list까지의 시작 순서다.

type Wire = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
};
type Entry = { kind: "send" | "recv"; data: Wire };
const fixtures = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function boot(
  options: { config?: Record<string, unknown>; resume?: string } = {},
) {
  const written: Wire[] = [];
  let emit: (text: string) => void = () => {};
  const link: CodexLink = {
    send: (text) => void written.push(JSON.parse(text)),
    onMessage: (listener) => void (emit = listener),
    onClose() {},
    close() {},
  };
  const proc: ExtensionProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {},
    onStdout() {},
    onStderr() {},
    onExit() {},
  };
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
  const adapter = createCodexAdapter({
    makeDir: () => "/tmp/lophn-codex-test",
    removeDir() {},
    connect: () => Promise.resolve(link),
  });
  const starting = adapter.start({
    terminal: null,
    cwd: "/work/startup",
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    session,
    spawn: () => proc,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });

  const rec = recording("startup");
  if (options.config !== undefined) {
    const config = rec.find((one) => one.data.result?.config !== undefined);
    (config?.data.result as { config: unknown }).config = options.config;
  }
  // resume이면 시작은 thread/start가 아니라 thread/resume과 앞 turn 목록 읽기다.
  if (options.resume !== undefined) {
    const start = rec.findIndex((one) => one.data.method === "thread/start");
    (rec[start] as Entry).data.method = "thread/resume";
    rec.splice(start + 2, 0, ...recording("origin"));
  }
  let at = 0;
  let sent = 0;
  let answered = 0;
  const requests = () =>
    written.filter((one) => one.id !== undefined && one.method !== undefined);

  const t = {
    written,
    get state() {
      return state;
    },
    async input(input: Record<string, unknown>) {
      listener?.({ session: "ses_x", ...input } as AcpInput);
      await flush();
    },
    /**
     * 녹화를 이어서 돌린다. `send` 줄은 adapter가 같은 순서로 요청했는지 보고(요청 id는 adapter의 것으로 맞춘다), `recv` 줄은
     * 내보낸다. server의 요청(승인·질문)을 내보내면 그 줄을 돌려주어 test가 창의 입력으로 답하게 한다.
     */
    async play(): Promise<Entry | undefined> {
      while (at < rec.length) {
        const entry = rec[at] as Entry;
        const data = entry.data;
        if (entry.kind === "send") {
          await flush();
          if (written.length <= sent) return entry;
          assert.equal((written[sent++] as Wire).method, data.method);
          at += 1;
          continue;
        }
        at += 1;
        const isResponse = data.method === undefined;
        const line = isResponse
          ? { ...data, id: requests()[answered++]?.id }
          : data;
        emit(`${JSON.stringify(line)}\n`);
        await flush();
        if (!isResponse && data.id !== undefined) return entry;
      }
      return undefined;
    },
    /** 손으로 만든 줄 하나를 server가 낸 것처럼 내보낸다. */
    async push(line: Wire) {
      emit(`${JSON.stringify(line)}\n`);
      await flush();
    },
    /** adapter가 마지막으로 보낸 `method` 요청에 답한다. 요청이 없으면 실패다. */
    async reply(method: string, result: Record<string, unknown>) {
      const asked = requests().findLast((one) => one.method === method);
      assert.ok(asked, `no ${method} request`);
      await t.push({ id: asked.id, result });
    },
    /** 이 녹화를 이어 붙인다. */
    append(name: string) {
      rec.push(...recording(name));
    },
  };
  await t.play();
  const started = await starting;
  assert.equal(started.ok, true);
  return { t, adapter, run: started.ok ? started.value : undefined };
}

/** 녹화한 turn/start가 보낸 글과 clientUserMessageId. 이 값으로 보내야 echo가 우리 것으로 읽힌다. */
function firstSend(name: string) {
  const start = recording(name)[0]?.data.params as {
    clientUserMessageId: string;
    input: { text: string }[];
  };
  return { id: start.clientUserMessageId, text: start.input[0]?.text ?? "" };
}

const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));
const ends = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );
const results = (written: Wire[]) =>
  written.filter((one) => one.result !== undefined && one.method === undefined);

async function ask(name: string) {
  const booted = await boot();
  booted.t.append(name);
  const sending = firstSend(name);
  await booted.t.input({
    type: "send",
    id: sending.id,
    key: sending.id,
    content: [{ type: "text", text: sending.text }],
    delivery: "next_turn",
  });
  const asked = (await booted.t.play()) as Entry;
  return { ...booted, asked };
}

const decisions = [
  {
    name: "decline",
    file: "decline",
    choice: { kind: "reject" },
    tool: "denied",
    decision: "decline",
  },
  {
    name: "patch",
    file: "patch",
    choice: { kind: "once" },
    tool: "ok",
    decision: "accept",
  },
] as const;

for (const row of decisions) {
  test(`승인은 창이 답하기 전까지 app-server에 답이 나가지 않고 답대로 끝난다 (${row.name})`, async () => {
    const { t, asked } = await ask(row.file);
    assert.ok(asked.data.method?.endsWith("/requestApproval"));

    // 창이 답하기 전: 승인도 거절도 가지 않았고 카드가 떠 있다.
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.equal(t.state.turn?.phase, "waiting");
    assert.equal(tools(t.state)[0]?.state, "running");
    assert.equal(results(t.written).length, 0);
    if (row.name === "patch")
      assert.equal(approval.subject.kind, "file_change");

    await t.input({ type: "decide", request: approval.id, choice: row.choice });
    assert.deepEqual(results(t.written), [
      { id: asked.data.id, result: { decision: row.decision } },
    ]);
    await t.play();

    // 거절해도 tool만 declined로 끝나고 turn은 이어 간다.
    assert.equal(tools(t.state)[0]?.state, row.tool);
    assert.equal(t.state.pending.approval, null);
    assert.deepEqual(ends(t.state), ["completed"]);
    assert.equal(t.state.reread, false);
  });
}

test("다른 client가 먼저 답하면(serverRequest/resolved) 이쪽 카드가 답 없이 닫힌다", async () => {
  const { t } = await ask("race");
  assert.ok(t.state.pending.approval);
  assert.equal(results(t.written).length, 0);

  await t.play();
  assert.equal(t.state.pending.approval, null);
  const closed = t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.outcome, "cancelled");
  assert.equal(results(t.written).length, 0);
  assert.deepEqual(ends(t.state), ["completed"]);
});

const scopes = [
  {
    name: "이 session 동안은 acceptForSession만",
    file: "session",
    choice: { kind: "session" },
    decision: "acceptForSession",
    choices: ["once", "session", "always", "reject"],
  },
  {
    name: "영구 규칙은 영구 선택지에서만",
    file: "session",
    choice: { kind: "always" },
    decision: {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ["touch", "session.txt"],
      },
    },
    choices: ["once", "session", "always", "reject"],
  },
  {
    // 서버가 acceptForSession을 내지 않은 요청은 session을 고르려 해도 한 번 허락이다.
    name: "서버가 내지 않은 session 범위는 한 번 허락으로 줄인다",
    file: "decline",
    choice: { kind: "session" },
    decision: "accept",
    choices: ["once", "always", "reject"],
  },
] as const;

for (const row of scopes) {
  test(`허락 범위: ${row.name}`, async () => {
    const { t } = await ask(row.file);
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.deepEqual(approval.choices, row.choices);
    // 영구 선택지에는 영구라는 표시가 붙는다.
    assert.match(approval.always_patterns[0] ?? "", /permanent/);

    await t.input({ type: "decide", request: approval.id, choice: row.choice });
    assert.deepEqual(
      results(t.written).map((one) => one.result),
      [{ decision: row.decision }],
    );
  });
}

const policies = [
  {
    name: "never + danger-full-access",
    config: { approval_policy: "never", sandbox_mode: "danger-full-access" },
    sent: { approvalPolicy: "on-request", sandbox: "workspace-write" },
  },
  {
    name: "사람이 read-only를 골랐다",
    config: { approval_policy: "on-request", sandbox_mode: "read-only" },
    sent: {},
  },
  {
    name: "untrusted",
    config: { approval_policy: "untrusted", sandbox_mode: "workspace-write" },
    sent: {},
  },
] as const;

for (const row of policies) {
  test(`권한은 사람 설정이 never·danger-full-access일 때만 바꾼다 (${row.name})`, async () => {
    const { t } = await boot({ config: row.config });
    const opened = t.written.find((one) => one.method === "thread/start");
    const params = opened?.params ?? {};
    const sent: { approvalPolicy?: string; sandbox?: string } = row.sent;
    assert.equal(params.approvalPolicy, sent.approvalPolicy);
    assert.equal(params.sandbox, sent.sandbox);
  });
}

test("질문은 question_asked가 되고 답은 질문 id로 app-server에 간다", async () => {
  const { t, asked } = await ask("question");
  assert.equal(asked.data.method, "item/tool/requestUserInput");
  const question = t.state.pending.question;
  assert.ok(question);
  assert.equal(question.questions?.[0]?.header, "Favorite color");
  assert.equal(results(t.written).length, 0);

  await t.input({
    type: "answer",
    tool_call: question.tool_call,
    answers: [
      {
        question: "What is your favorite color?",
        status: "answered",
        answer: ["Blue"],
      },
    ],
  });
  assert.deepEqual(
    results(t.written).map((one) => one.result),
    [{ answers: { favorite_color: { answers: ["Blue"] } } }],
  );
  await t.play();
  assert.equal(t.state.pending.question, null);
  assert.deepEqual(ends(t.state), ["completed"]);
});

test("TUI 같은 다른 client가 보낸 메시지는 사람 메시지로 보이고 우리가 보낸 echo는 다시 그리지 않는다", async () => {
  const { t } = await boot();
  t.append("foreign");
  await t.play();
  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item] : [],
  );
  assert.deepEqual(
    users.map((item) => item.content),
    [[{ type: "text", text: "Reply with exactly: from b" }]],
  );
  assert.deepEqual(ends(t.state), ["completed"]);
});

const permissionRows = [
  { name: "거절", choice: { kind: "reject" }, granted: false },
  { name: "한 번", choice: { kind: "once" }, granted: true },
  // 창이 turn을 멈추면 카드는 취소로 닫히고 권한은 나가지 않는다.
  { name: "취소", choice: null, granted: false },
] as const;

for (const row of permissionRows) {
  test(`추가 권한 요청은 창이 답하기 전까지 app-server에 답이 나가지 않는다 (${row.name})`, async () => {
    const { t, asked } = await ask("permissions");
    assert.equal(asked.data.method, "item/permissions/requestApproval");
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.equal(approval.subject.kind, "mcp_tool");
    assert.deepEqual(approval.choices, ["once", "session", "reject"]);
    assert.equal(results(t.written).length, 0);

    if (row.choice === null)
      await t.input({ type: "stop", turn: t.state.turn?.id, key: "stop" });
    else
      await t.input({
        type: "decide",
        request: approval.id,
        choice: row.choice,
      });
    // 한 번은 요청한 권한을 이 turn에만, 나머지는 빈 권한이다.
    const asking = (
      asked.data.params as { permissions: { fileSystem: unknown } }
    ).permissions;
    assert.deepEqual(
      results(t.written).map((one) => one.result),
      [
        {
          permissions: row.granted ? { fileSystem: asking.fileSystem } : {},
          scope: "turn",
        },
      ],
    );
  });
}

test("resume 뒤 다시 그린 사람 메시지의 origin은 처음 보낼 때의 id와 같다", async () => {
  const userOrigins = (state: AcpState) =>
    state.items.flatMap((item) =>
      item.kind === "message" && item.actor === "user" ? [item.origin] : [],
    );
  // 창이 보낸 id를 clientUserMessageId로 보내므로 그 id가 origin이다.
  const first = await boot();
  await first.t.input({
    type: "send",
    id: "msg_a1",
    key: "msg_a1",
    content: [{ type: "text", text: "Reply with exactly: first" }],
    delivery: "next_turn",
  });
  assert.deepEqual(userOrigins(first.t.state), ["msg_a1"]);

  // 다시 열면 app-server가 돌려주는 clientId가 같은 key다. 어긋나면 사람의 bookmark를 잃는다.
  const again = await boot({ resume: "01a1aa8e-4ef3-7541-8699-96c63c40a8bb" });
  assert.deepEqual(userOrigins(again.t.state), ["msg_a1", "msg_a2"]);
});

const requested = (written: Wire[], method: string) =>
  written.filter((one) => one.method === method && one.id !== undefined);

test("`!ls`는 thread/shellCommand로만 가고 그 줄은 사람 쪽 tool 하나다(사람 메시지도 turn 꼬리도 없다)", async () => {
  const { t } = await boot();
  const thread = t.state.session?.cli_session as string;
  await t.input({
    type: "send",
    id: "msg_s1",
    key: "msg_s1",
    content: [{ type: "text", text: "!ls" }],
    delivery: "next_turn",
  });
  assert.equal(requested(t.written, "turn/start").length, 0);
  assert.deepEqual(
    requested(t.written, "thread/shellCommand").map((one) => one.params),
    [{ threadId: thread, command: "ls" }],
  );
  assert.equal(t.state.items.length, 0);

  // app-server가 제 turn을 열고 commandExecution(userShell) 하나만 낸다.
  const item = {
    type: "commandExecution",
    id: "item_s1",
    source: "userShell",
    command: "/bin/bash -lc ls",
    commandActions: [{ type: "listFiles", command: "ls" }],
    status: "completed",
    aggregatedOutput: "a.txt\n",
  };
  const turn = { id: "wire_s1", status: "inProgress", items: [] };
  await t.push({
    method: "turn/started",
    params: { threadId: thread, turn },
  });
  await t.push({
    method: "item/started",
    params: { threadId: thread, turnId: turn.id, item },
  });
  await t.push({
    method: "item/completed",
    params: { threadId: thread, turnId: turn.id, item },
  });
  await t.push({
    method: "turn/completed",
    params: { threadId: thread, turn: { ...turn, status: "completed" } },
  });

  assert.deepEqual(
    t.state.items.map((one) => one.kind),
    ["tool"],
  );
  const [tool] = tools(t.state);
  assert.equal(tool?.by, "user");
  assert.equal(tool?.turn, null);
  assert.equal(tool?.state, "ok");
  assert.equal(tool?.body?.output, "a.txt\n");

  // run_shell 입력도 같은 호출이다. 도는 turn이 있어도 prompt로 가지 않는다.
  await t.input({ type: "run_shell", key: "k", command: "echo hi" });
  assert.equal(requested(t.written, "turn/start").length, 0);
  assert.equal(requested(t.written, "thread/shellCommand").length, 2);
});

test("open_session은 thread/resume에 고른 id를 싣고 session_reset 뒤에는 그 thread의 turn만 남는다", async () => {
  // 앞 thread에 사람 메시지 둘이 이미 그려져 있다.
  const { t } = await boot({ resume: "01a1aa8e-4ef3-7541-8699-96c63c40a8bb" });
  assert.equal(t.state.items.length > 0, true);

  await t.input({ type: "open_session", key: "k", cli_session: "thr_old" });
  assert.deepEqual(
    requested(t.written, "thread/resume")
      .slice(-1)
      .map((one) => one.params?.threadId),
    ["thr_old"],
  );
  await t.reply("thread/resume", {
    thread: { id: "thr_old", name: "Old one" },
    model: "m",
  });
  assert.deepEqual(
    requested(t.written, "thread/turns/list")
      .slice(-1)
      .map((one) => one.params?.threadId),
    ["thr_old"],
  );
  await t.reply("thread/turns/list", {
    data: [
      {
        id: "wire_old",
        status: "completed",
        items: [
          {
            type: "userMessage",
            id: "um1",
            clientId: "msg_old",
            content: [{ type: "text", text: "from the old one" }],
          },
          { type: "agentMessage", id: "am1", text: "old answer" },
        ],
      },
    ],
    nextCursor: null,
  });

  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.content] : [],
  );
  assert.deepEqual(users, [[{ type: "text", text: "from the old one" }]]);
  assert.equal(t.state.session?.cli_session, "thr_old");
  assert.equal(t.state.session?.title, "Old one");
});
