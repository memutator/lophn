import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../base/clock.ts";
import { createIdSource } from "../../base/id.ts";
import { seededRandom } from "../../base/random.ts";
import type { AcpInput } from "../../protocol/acp/input.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import type { AcpState } from "../../protocol/acp/state.ts";
import type { AcpSessionHandle, CliProcess } from "../../protocol/acp/mod.ts";
import { createOpencodeAdapter, type OpencodeTransport } from "./opencode.ts";

// 녹화(fixtures/opencode)로 adapter를 돌린다. 실제 `opencode`는 띄우지 않고, server와 말하는 길을 녹화를 재생하는 대역으로
// 바꾼다. 녹화는 GUI 쪽 client(A)가 본 것이다: adapter가 부른 요청마다 녹화된 응답을 주고, 그 사이에 녹화된 event를 흘린다.

type Entry = { kind: string; data: Record<string, unknown> };
const fixtures = fileURLToPath(
  new URL("./fixtures/opencode/", import.meta.url),
);
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(
  name: string,
  resume?: string,
  member?: { deny: readonly string[] },
) {
  const rec = [...recording("start"), ...recording(name)];
  // 손으로 만든 줄: 저장된 적 없는 session을 읽으면 server가 404로 답한다.
  if (resume !== undefined)
    rec.splice(1, 0, {
      kind: "http",
      data: {
        client: "A",
        method: "GET",
        path: `/api/session/${resume}`,
        status: 404,
        error: "Session not found",
      },
    });
  type Waiter = {
    method: string;
    path: string;
    body: unknown;
    resolve(value: unknown): void;
    reject(error: Error): void;
  };
  const waiting: Waiter[] = [];
  // 녹화에 없는 요청에 바로 답한다. 키는 "METHOD path"다.
  const auto = new Map<string, unknown>();
  // adapter가 보낸 요청(method, path, body)을 순서대로.
  const requests: { method: string; path: string; body: unknown }[] = [];
  let emit: (event: Record<string, unknown>) => void = () => {};
  // SSE를 연 횟수와 끊김을 알리는 길. server process를 끈 횟수.
  let subscribes = 0;
  let end: (error: Error) => void = () => {};
  const stopped = { kill: 0 };
  const transport: OpencodeTransport = {
    request: (method, path, options) =>
      new Promise((resolve, reject) => {
        requests.push({ method, path, body: options?.body });
        if (auto.has(`${method} ${path}`)) {
          resolve(auto.get(`${method} ${path}`) as undefined);
          return;
        }
        waiting.push({
          method,
          path,
          body: options?.body,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      }),
    events(onEvent, onEnd) {
      subscribes += 1;
      emit = onEvent;
      end = onEnd;
      return { close() {} };
    },
  };

  let at = 0;
  async function pump() {
    for (let round = 0; round < 50; round++) {
      await flush();
      const entry = rec[at];
      if (entry === undefined) return;
      const data = entry.data;
      if (entry.kind === "event" && data.client === "A") {
        emit(data.event as Record<string, unknown>);
      } else if (entry.kind === "http" && data.client === "A") {
        const index = waiting.findIndex(
          (one) => one.method === data.method && one.path === data.path,
        );
        const found = waiting[index];
        if (found === undefined) return;
        waiting.splice(index, 1);
        if (data.error !== undefined) {
          found.reject(
            Object.assign(new Error(String(data.error)), {
              status: data.status,
            }),
          );
        } else found.resolve(data.response);
      }
      at += 1;
    }
  }

  const stdout: ((text: string) => void)[] = [];
  const spawned: { command: string; args: readonly string[]; env?: unknown }[] =
    [];
  const proc: CliProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {
      stopped.kill += 1;
    },
    onStdout: (listener) => {
      stdout.push(listener);
      setImmediate(() => listener('{"url":"http://127.0.0.1:1"}\n'));
    },
    onStderr() {},
    onExit() {},
  };

  let state: AcpState = EMPTY_ACP_STATE;
  let listener: ((input: AcpInput) => void) | undefined;
  const session: AcpSessionHandle = {
    id: "win_test",
    publish: (update) => void (state = reduceAcp(state, update)),
    onInput: (fn) => void (listener = fn),
    onClose() {},
    close() {},
  };
  const secrets: string[] = [];
  const exported: { name: string; text: string }[] = [];
  const adapter = createOpencodeAdapter({
    connect: () => transport,
    async writeSecret(text) {
      secrets.push(text);
      return { path: "/tmp/lophn-opencode-x/password", remove: async () => {} };
    },
    async writeExport(name, text) {
      exported.push({ name, text });
      return `/tmp/${name}`;
    },
    home: "/home/user",
    readCommandTemplates: async () => new Map(),
  });
  const clock = manualClock(Date.UTC(2026, 10, 5));
  let started: Awaited<ReturnType<typeof adapter.start>> | undefined;
  void adapter
    .start({
      terminal: null,
      cwd: "/work",
      ...(resume === undefined ? {} : { resume }),
      ...(member === undefined ? {} : { member }),
      session,
      spawn: (command, args, options) => {
        spawned.push({ command, args, env: options?.env });
        return proc;
      },
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
    })
    .then((result) => void (started = result));
  for (let round = 0; round < 50 && started === undefined; round++)
    await pump();
  assert.equal(started?.ok, true);
  await pump();

  return {
    get state() {
      return state;
    },
    requests,
    spawned,
    secrets,
    exported,
    auto,
    emit: (event: Record<string, unknown>) => emit(event),
    end: (error: Error) => end(error),
    stopped,
    get subscribes() {
      return subscribes;
    },
    run: started?.ok === true ? started.value : undefined,
    pump,
    async input(input: Record<string, unknown>) {
      listener?.({ session: "ses_x", ...input } as AcpInput);
      await flush();
    },
    send: (id: string, text: string) => ({
      type: "send",
      id: `msg_${id}`,
      key: id,
      content: [{ type: "text", text }],
      delivery: "next_turn",
    }),
  };
}

// 녹화에서 model이 먼저 codemode의 `execute`를 잘못 불러 tool 줄이 둘이다. 승인이 걸리는 것은 `shell`이다.
const shellTool = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "tool" && item.tool === "shell" ? [item] : [],
  )[0];
const ends = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );
const replies = (requests: { method: string; path: string; body: unknown }[]) =>
  requests.filter((one) => one.path.endsWith("/reply"));

// 승인 요청이 떠 있는 데까지 간다.
async function untilAsked(name: string) {
  const t = await setup(name);
  await t.input(
    t.send(
      "1",
      "Use your shell tool to run exactly this command: touch once.txt .",
    ),
  );
  await t.pump();
  const approval = t.state.pending.approval;
  assert.ok(approval);
  return { t, approval };
}

test("저장된 적 없는 session(404)을 resume하면 실패 줄 없이 새 session을 연다", async () => {
  const t = await setup("approve_once", "ses_gone");
  assert.equal(
    t.requests.filter(
      (one) => one.method === "POST" && one.path === "/api/session",
    ).length,
    1,
  );
  assert.deepEqual(t.state.items, []);
});

test("permission 요청은 창이 답하기 전까지 reply가 나가지 않고, 답하면 once가 나간다", async () => {
  const { t, approval } = await untilAsked("approve_once");
  assert.equal(approval.subject.kind, "shell");
  assert.equal(t.state.turn?.phase, "waiting");
  assert.equal(shellTool(t.state)?.state, "running");
  assert.equal(replies(t.requests).length, 0);

  await t.input({
    type: "decide",
    request: approval.id,
    choice: { kind: "once" },
  });
  await t.pump();

  assert.deepEqual(
    replies(t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  assert.equal(shellTool(t.state)?.state, "ok");
  // server가 돌려준 표지로 우리가 보낸 메시지를 알아보므로 사람 메시지는 한 번만 그려진다.
  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.id] : [],
  );
  assert.deepEqual(users, ["msg_1"]);
  assert.equal(t.state.pending.approval, null);
  assert.deepEqual(ends(t.state), ["completed"]);
  assert.equal(t.state.reread, false);
});

test("거절하면 reply가 reject와 이유를 싣고, 그 tool은 거절로 끝나며 turn은 stopped로 그려지지 않는다", async () => {
  const { t, approval } = await untilAsked("deny_reason");
  await t.input({
    type: "decide",
    request: approval.id,
    choice: { kind: "reject", reason: "Do not create files here." },
  });
  await t.pump();

  assert.deepEqual(
    replies(t.requests).map((one) => one.body),
    [{ decision: "reject", message: "Do not create files here." }],
  );
  assert.equal(shellTool(t.state)?.state, "denied");
  assert.deepEqual(ends(t.state), ["completed"]);
  const closed = t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.outcome, "denied");
  assert.equal(
    closed?.kind === "approval" && closed.reason,
    "Do not create files here.",
  );
});

test("다른 client가 먼저 답하면 이쪽 카드가 답 없이 닫힌다", async () => {
  // 녹화에서는 B가 답하고, A는 `permission.replied`를 받는다. adapter는 reply를 보내지 않는다.
  const t = await setup("approve_other");
  await t.input(
    t.send(
      "1",
      "Use your shell tool to run exactly this command: touch once.txt .",
    ),
  );
  await t.pump();

  assert.equal(t.state.pending.approval, null);
  assert.equal(replies(t.requests).length, 0);
  const closed = t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.outcome, "allowed");
  assert.equal(t.state.reread, false);
  assert.deepEqual(ends(t.state), ["completed"]);
});

test("이 session 동안 허락은 session.update permissions와 once만 보내고 always를 보내지 않는다. always는 영구로 표시된 선택에서만 나간다", async () => {
  const session = await untilAsked("approve_session");
  // always는 사람의 project에 영구 규칙으로 남는 선택이라 영구라고 적어 내놓는다.
  assert.deepEqual(session.approval.choices, [
    "once",
    "session",
    "always",
    "reject",
  ]);
  assert.match(session.approval.always_patterns.join(" "), /permanent/i);
  await session.t.input({
    type: "decide",
    request: session.approval.id,
    choice: { kind: "session" },
  });
  await session.t.pump();

  const patch = session.t.requests.find((one) => one.method === "PATCH");
  assert.deepEqual(patch?.body, {
    permissions: [{ action: "shell", resource: "touch *", effect: "allow" }],
  });
  assert.deepEqual(
    replies(session.t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  const closed = session.t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.choice, "session");

  const always = await untilAsked("approve_once");
  await always.t.input({
    type: "decide",
    request: always.approval.id,
    choice: { kind: "always" },
  });
  await always.t.pump();
  assert.deepEqual(
    replies(always.t.requests).map((one) => one.body),
    [{ decision: "always" }],
  );
});

test("tab 전용 server의 password는 spawn env의 그 칸과 0600 file에만 있고 TUI 명령 글에는 없다", async () => {
  const t = await setup("approve_once");
  const [spawn] = t.spawned;
  assert.deepEqual(spawn?.args, ["serve", "--stdio", "--port", "0"]);
  const env = spawn?.env as Record<string, string>;
  // extension spawner가 login shell env 위에 이 env를 얹으니 바꾸는 칸만 넘긴다.
  assert.deepEqual(Object.keys(env), ["OPENCODE_PASSWORD"]);
  const password = env.OPENCODE_PASSWORD;
  assert.equal(t.secrets[0], password);

  const command = t.run?.tuiCommand();
  assert.ok(command !== undefined && !command.includes(password ?? ""));
  assert.match(
    command ?? "",
    /^OPENCODE_PASSWORD="\$\(cat '\/tmp\/lophn-opencode-x\/password'\)" opencode --server http:\/\/127\.0\.0\.1:1 --session ses_test$/,
  );
});

const userIds = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.id] : [],
  );

test("auto-accept는 permission 요청마다 once reply만 보내고 always reply와 session 규칙(PATCH)은 보내지 않는다", async () => {
  // approve_session 녹화는 요청이 session 규칙으로 저장할 resource(`save`)를 싣는다. 카드가 떴다면 session·always도 고를 수 있던 요청이다.
  const t = await setup("approve_session");
  await t.input({
    type: "set_toggle",
    key: "toggle_1",
    id: "auto_accept",
    on: true,
  });
  assert.equal(t.state.session?.toggles[0]?.on, true);
  await t.input(
    t.send(
      "1",
      "Use your shell tool to run exactly this command: touch once.txt .",
    ),
  );
  await t.pump();

  assert.deepEqual(
    replies(t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  assert.equal(t.requests.filter((one) => one.method === "PATCH").length, 0);
  assert.equal(t.state.pending.approval, null);

  // 카드가 이미 떠 있을 때 켜면 그 카드도 once로 답한다.
  const open = await untilAsked("approve_once");
  await open.t.input({
    type: "set_toggle",
    key: "toggle_1",
    id: "auto_accept",
    on: true,
  });
  await open.t.pump();
  assert.deepEqual(
    replies(open.t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  assert.equal(open.t.state.pending.approval, null);
});

test("undo, redo, new가 각각 revert/stage, DELETE revert, POST /api/session에 닿고 redo 뒤 숨긴 메시지가 같은 자리로 돌아온다", async () => {
  const t = await setup("undo_redo");
  await t.input(
    t.send("1", "Create a file named a.txt containing the word alpha."),
  );
  await t.pump();
  await t.input(
    t.send("2", "Create a file named b.txt containing the word beta."),
  );
  await t.pump();
  const shown = () =>
    t.state.items
      .filter((item) => item.kind !== "notice")
      .map((item) => item.id);
  const before = shown();
  assert.deepEqual(userIds(t.state), ["msg_1", "msg_2"]);

  await t.input({
    type: "run_command",
    key: "cmd_undo",
    name: "undo",
    argument: "",
  });
  await t.pump();
  const stage = t.requests.find((one) => one.path.endsWith("/revert/stage"));
  // 둘째 사람 메시지의 server id(inbox id)와 file 되돌리기를 싣는다.
  assert.deepEqual(stage?.body, {
    messageID: "msg_1ab5c3a9e001J5LrOxXzBFSIEI",
    files: true,
  });
  assert.deepEqual(userIds(t.state), ["msg_1"]);
  assert.ok(t.state.items.some((item) => item.kind === "hidden"));

  await t.input({
    type: "run_command",
    key: "cmd_redo",
    name: "redo",
    argument: "",
  });
  await t.pump();
  assert.ok(
    t.requests.some(
      (one) => one.method === "DELETE" && one.path.endsWith("/revert"),
    ),
  );
  assert.deepEqual(shown(), before);
  assert.deepEqual(userIds(t.state), ["msg_1", "msg_2"]);

  t.auto.set("POST /api/session", { data: { id: "ses_new" } });
  t.auto.set("GET /api/session/ses_new", {
    data: { id: "ses_new", title: "New" },
  });
  t.auto.set("GET /api/session/ses_new/message", { data: [] });
  await t.input({
    type: "run_command",
    key: "cmd_new",
    name: "new",
    argument: "",
  });
  await flush();
  assert.equal(
    t.requests.filter(
      (one) => one.method === "POST" && one.path === "/api/session",
    ).length,
    2,
  );
  assert.equal(t.run?.sessionId(), "ses_new");
});

test("subagent 줄은 tool 결과의 session id로 자식과 짝지어지고 자식의 대화는 children에 든다", async () => {
  const t = await setup("subagent");
  await t.input(
    t.send("1", "Use the subagent tool with agent general to read notes.txt."),
  );
  await t.pump();
  await t.pump();

  const line = t.state.items.find(
    (item) => item.kind === "tool" && item.tool === "subagent",
  );
  assert.ok(line?.kind === "tool" && line.detail.kind === "subagent");
  const child = line.detail.child;
  assert.equal(child, "ses_e54a76458ffemKav4BvS3st6YP");
  assert.equal(line.detail.state, "done");
  assert.match(line.detail.last ?? "", /2 lines/);
  const inner = t.state.children[child ?? ""];
  assert.ok(inner !== undefined);
  assert.ok(
    inner.items.some((item) => item.kind === "tool" && item.tool === "read"),
  );
  assert.equal(inner.turn?.phase, "ended");
  // 앞에서 끝난 foreground 자식은 background task가 아니다.
  assert.deepEqual(t.state.tasks, []);
});

test("background 자식은 task로 오르고 stop_task가 자식 session에 interrupt를 보낸다", async () => {
  const t = await setup("subagent_background");
  await t.input(
    t.send(
      "1",
      "Call the subagent tool with agent general and background true.",
    ),
  );
  await t.pump();
  const child = "ses_e54a723afffef07u08lgP6GzfZ";
  // 부모 turn이 끝난 뒤에도 자식이 돈다.
  assert.equal(t.state.tasks[0]?.id, child);
  assert.equal(t.state.tasks[0]?.state, "running");
  assert.equal(t.run?.running().tasks, 1);

  await t.input({ type: "stop_task", key: "stop_1", task: child });
  await t.pump();
  assert.ok(
    t.requests.some(
      (one) =>
        one.method === "POST" && one.path === `/api/session/${child}/interrupt`,
    ),
  );
  assert.equal(t.state.tasks[0]?.state, "stopped");
  assert.equal(t.run?.running().tasks, 0);
});

test("background_tool은 session의 도는 tool을 server의 background API로 보낸다", async () => {
  const t = await setup("approve_once");
  t.auto.set("POST /api/session/ses_test/background", undefined);
  await t.input({ type: "background_tool", key: "bg_1" });
  await t.pump();
  assert.ok(
    t.requests.some(
      (one) =>
        one.method === "POST" &&
        one.path === "/api/session/ses_test/background",
    ),
  );
});

test("todowrite의 todo가 plan이 되고 빈 항목은 빠진다", async () => {
  const t = await setup("approve_once");
  t.emit({
    type: "session.tool.input.started",
    data: { sessionID: "ses_test", id: "call_todo", name: "todowrite" },
  });
  t.emit({
    type: "session.tool.called",
    data: {
      sessionID: "ses_test",
      id: "call_todo",
      input: {
        todos: [
          { content: "Read notes", status: "completed" },
          { content: "Write summary", status: "in_progress" },
          { content: "", status: "pending" },
        ],
      },
    },
  });
  t.emit({
    type: "session.tool.success",
    data: { sessionID: "ses_test", id: "call_todo", content: [], metadata: {} },
  });
  assert.deepEqual(t.state.plan?.entries, [
    { text: "Read notes", status: "completed" },
    { text: "Write summary", status: "in_progress" },
  ]);
});

test("/export, /stats, /mcps, /skills가 command_output으로 나오고 export는 tmpdir 파일 경로를 알린다", async () => {
  const t = await setup("server_reads");
  const outputs = () =>
    t.state.items.flatMap((item) =>
      item.kind === "notice" && item.notice.type === "command_output"
        ? [item.notice]
        : [],
    );
  for (const name of ["stats", "export", "mcps", "skills"]) {
    await t.input({
      type: "run_command",
      key: `cmd_${name}`,
      name,
      argument: "",
    });
    await t.pump();
  }
  const [stats, exported, mcps, skills] = outputs();
  assert.equal(stats?.command, "stats");
  assert.match(stats?.text ?? "", /Sessions \| 7/);
  assert.equal(exported?.command, "export");
  assert.match(exported?.text ?? "", /\/tmp\/session-ses_test\.json/);
  assert.equal(t.exported[0]?.name, "session-ses_test.json");
  assert.match(mcps?.text ?? "", /No MCP servers/);
  assert.match(skills?.text ?? "", /OpenCode/);
});

test("`!ls`는 POST …/shell로만 가고 prompt로 가지 않는다. 그 shell은 by user tool 줄 하나이고 사람 말풍선이 없다", async () => {
  const t = await setup("shell_live");
  await t.input(t.send("sh", "!ls"));
  await t.pump();
  const paths = t.requests.map((one) => `${one.method} ${one.path}`);
  assert.ok(paths.includes("POST /api/session/ses_test/shell"));
  assert.ok(!paths.some((one) => one.endsWith("/prompt")));
  const lines = t.state.items.filter((item) => item.kind === "tool");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.kind === "tool" && lines[0].by, "user");
  assert.equal(lines[0]?.kind === "tool" && lines[0].state, "ok");
  assert.ok(
    !t.state.items.some(
      (item) => item.kind === "message" && item.actor === "user",
    ),
  );
  // 도는 execution이 없어 turn을 열지도 닫지도 않는다.
  assert.deepEqual(ends(t.state), []);
});

// 팀원 탭의 `!`는 사람이 친 명령이다. server의 shell이 turn 자격 file 없이 돌게 맨 앞에 unset을 붙인다.
test("a member tab's `!` goes to the server with the turn credential file unset, and a person's tab sends the command as typed", async () => {
  const member = await setup("shell_live", undefined, { deny: [] });
  await member.input(member.send("sh", "!lophn tab open --url https://x"));
  const shell = (t: typeof member) =>
    t.requests.find((one) => one.path.endsWith("/shell"))?.body as {
      command: string;
    };
  assert.equal(
    shell(member).command,
    "unset LOPHN_AGENT_CREDENTIAL_FILE; lophn tab open --url https://x",
  );
  const person = await setup("shell_live");
  await person.input(person.send("sh", "!ls"));
  assert.equal(shell(person).command, "ls");
});

const notices = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "info"
      ? [item.notice.text]
      : [],
  );

test("모양이 틀린 event와 SSE 끊김이 와도 session이 살고, adapter가 다시 구독하며, server process를 끄지 않는다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = await setup("approve_once");
    // 읽을 수 없는 event는 그 하나만 버리고 알림은 한 번만 난다.
    t.emit(null as never);
    t.emit(null as never);
    assert.equal(
      notices(t.state).filter((one) => one.includes("could not read")).length,
      1,
    );

    // 도는 turn이 있는 채로 끊겼다가 다시 붙으면, 그 사이 끝난 turn은 닫힌다.
    t.emit({
      type: "session.execution.started",
      data: { sessionID: "ses_test" },
    });
    t.auto.set("GET /api/session/ses_test/message", {
      data: [{ type: "idle", outcome: "succeeded" }],
    });
    t.end(new Error("closed"));
    assert.equal(t.subscribes, 1);
    mock.timers.tick(500);
    assert.equal(t.subscribes, 2);
    t.emit({ type: "server.connected", data: {} });
    await flush();
    assert.deepEqual(ends(t.state), ["completed"]);

    // event가 하나 오면 횟수가 되살아난다. event 없이 다섯 번 이어 끊겨야 죽고, 그때 server를 끈다.
    for (let failed = 1; failed <= 5; failed++) {
      t.end(new Error("closed"));
      if (failed < 5) {
        assert.equal(t.stopped.kill, 0);
        mock.timers.tick(10_000);
      }
    }
    assert.equal(t.subscribes, 6);
    assert.equal(t.stopped.kill, 1);
    const failed = t.state.items.find(
      (item) => item.kind === "notice" && item.notice.type === "error",
    );
    assert.ok(failed);
  } finally {
    mock.timers.reset();
  }
});

// 시작 실패의 길만 보는 adapter. 실제 server 없이 요청과 password file을 대역으로 바꾼다.
function bareStart(deps: {
  request?: OpencodeTransport["request"];
  writeSecret?: () => Promise<{ path: string; remove(): Promise<void> }>;
}) {
  const stopped = { kill: 0 };
  const proc: CliProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {
      stopped.kill += 1;
    },
    onStdout: (listener) =>
      void setImmediate(() => listener('{"url":"http://127.0.0.1:1"}\n')),
    onStderr() {},
    onExit() {},
  };
  const adapter = createOpencodeAdapter({
    connect: () => ({
      request: deps.request ?? (() => new Promise(() => {})),
      events: () => ({ close() {} }),
    }),
    writeSecret:
      deps.writeSecret ??
      (async () => ({ path: "/tmp/x/password", remove: async () => {} })),
    writeExport: async () => "",
    home: "/home/user",
    readCommandTemplates: async () => new Map(),
  });
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const result = adapter.start({
    terminal: null,
    cwd: "/work",
    session: {
      id: "win_test",
      publish() {},
      onInput() {},
      onClose() {},
      close() {},
    },
    spawn: () => proc,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  return { result, stopped };
}

test("/api/info에 답하지 않으면 30초 뒤 start가 unavailable로 끝나고 server process를 끈다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = bareStart({});
    await flush();
    await flush();
    mock.timers.tick(30_000);
    const result = await t.result;
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "unavailable");
    assert.match(result.error.message, /did not answer GET \/api\/info/);
    assert.equal(t.stopped.kill, 1);
  } finally {
    mock.timers.reset();
  }
});

test("password file을 못 쓰면 start가 실패하고 server process를 끈다", async () => {
  const t = bareStart({
    writeSecret: () => Promise.reject(new Error("ENOSPC: no space left")),
  });
  const result = await t.result;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unavailable");
  assert.match(result.error.message, /could not start: ENOSPC/);
  assert.equal(t.stopped.kill, 1);
});
