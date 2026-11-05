import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
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
import type { AcpState } from "../../../../../protocol/acp/state.ts";
import type {
  AcpSessionHandle,
  AcpTerminal,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import { createOmpAdapter } from "./omp.ts";

// 녹화(fixtures/omp, omp 18.8.7)로 adapter를 돌린다. 진짜 omp는 띄우지 않고, spawn이 주는 process를 녹화한 줄을 내는 대역으로
// 바꾼다. 명령의 답은 녹화에서 같은 명령의 답을 차례로 쓰고(id만 adapter가 정한 값), 이벤트 줄은 test가 `play`로 내보낸다.
// 위험한 규칙만 본다: 승인은 창이 답하기 전에는 응답하지 않고, "이 session 동안"은 omp가 그 선택지를 줄 때만 내놓고 영구 규칙은
// 답하지 않으며, `ask`는 질문이 tool 줄보다 먼저 와도 같은 줄에 붙고, TUI 전환과 승인 mode 바꾸기는 한 session에 두 process를
// 같이 쥐지 않고, model turn이 없는 session은 TUI가 `--resume`으로 열지 않고, `!cmd`는 model에게 가지 않고 사람이 돌린 줄로만 그려지고,
// 사람의 전역 omp 설정을 쓰는 입력(slow 전역, model role)은 보내지 않고, 도는 중 명령은 버려지지 않으며 도는 turn을 끝내지 않는다.

type Frame = Record<string, unknown>;
type Entry = { kind: string; data: Frame };
const fixtures = fileURLToPath(new URL("./fixtures/omp/", import.meta.url));
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

// 녹화에 없는 명령은 이 답으로 채운다.
const FALLBACK: Record<string, unknown> = {
  get_state: { sessionId: "ses-1", todoPhases: [] },
  get_available_thinking_levels: { levels: ["off", "low"] },
  get_available_models: { models: [] },
  get_available_commands: { commands: [] },
  get_session_stats: {},
  get_subagents: { subagents: [] },
};
const HANDSHAKE = new Set([
  "negotiate_protocol",
  "set_ask_dialog",
  "set_event_filter",
  "set_subagent_subscription",
  "get_state",
  "get_available_models",
  "get_available_commands",
  "get_available_thinking_levels",
  "get_session_stats",
  "get_subagents",
]);

const noDisk = {
  readFile: () => Promise.reject(new Error("no files")),
  readDir: () => Promise.reject(new Error("no folder")),
  readHead: () => Promise.reject(new Error("no file")),
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Fake = {
  args: readonly string[];
  ended: boolean;
  emit(frame: Frame): void;
  exit(code: number | null): void;
};

async function setup(
  name: string,
  options: {
    /** 내보내는 이벤트 줄을 바꾼다. */
    tweak?: (frame: Frame) => Frame;
    /** `get_state` 답에 덧씌운다. */
    state?: Frame;
    /** 읽을 수 있는 file(경로 → 글). 나머지는 없는 file이다. */
    files?: Record<string, string>;
    /** session 폴더(file 이름 → 앞 글). */
    folder?: Record<string, string>;
  } = {},
) {
  const tweak = options.tweak ?? ((frame: Frame) => frame);
  const rec = recording(name);
  const answers = new Map<string, Frame[]>();
  for (const entry of rec) {
    if (entry.kind === "recv" && entry.data.type === "response") {
      const command = entry.data.command as string;
      answers.set(command, [...(answers.get(command) ?? []), entry.data]);
    }
  }
  // 이벤트는 첫 prompt를 보낸 자리부터 내보낸다(그 앞은 시작 순서다).
  let at = rec.findIndex(
    (entry) =>
      entry.kind === "send" && !HANDSHAKE.has(entry.data.type as string),
  );
  const sent: Frame[] = [];
  const fakes: Fake[] = [];
  const spawnProc = (args: readonly string[]): ExtensionProcess => {
    let out: (text: string) => void = () => {};
    let exit: (code: number | null) => void = () => {};
    const fake: Fake = {
      args,
      ended: false,
      emit: (frame) => out(`${JSON.stringify(frame)}\n`),
      exit: (code) => exit(code),
    };
    fakes.push(fake);
    return {
      pid: 1,
      write(text) {
        const body = JSON.parse(text) as Frame;
        sent.push(body);
        const type = body.type as string;
        if (type === "extension_ui_response") return;
        const list = answers.get(type) ?? [];
        const recorded = list.length > 1 ? list.shift() : list[0];
        const reply: Frame =
          recorded === undefined
            ? {
                type: "response",
                id: body.id,
                command: type,
                success: true,
                data: FALLBACK[type],
              }
            : { ...recorded, id: body.id };
        if (type === "get_state" && options.state !== undefined) {
          reply.data = { ...(reply.data as Frame), ...options.state };
        }
        setImmediate(() => fake.emit(reply));
      },
      end: () => void (fake.ended = true),
      kill() {},
      onStdout: (fn) => void (out = fn),
      onStderr() {},
      onExit: (fn) => void (exit = fn),
    };
  };
  const latest = () => fakes[fakes.length - 1] as Fake;
  const emit = (frame: Frame) => latest().emit(frame);

  let state: AcpState = EMPTY_ACP_STATE;
  let input: (message: AcpInput) => void = () => {};
  const session: AcpSessionHandle = {
    id: "win_test",
    publish: (update) => void (state = reduceAcp(state, update)),
    onInput: (fn) => void (input = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const started = createOmpAdapter({
    ...noDisk,
    home: "/home/test",
    readDir: () => Promise.resolve(Object.keys(options.folder ?? {})),
    readHead: (path) => {
      const text = options.folder?.[basename(path)];
      return text === undefined
        ? Promise.reject(new Error("no file"))
        : Promise.resolve(text);
    },
    readFile: (path) => {
      const text = options.files?.[path];
      return text === undefined
        ? Promise.reject(new Error("no file"))
        : Promise.resolve(new TextEncoder().encode(text));
    },
  }).start({
    terminal: null,
    cwd: `/work/${name}`,
    session,
    spawn: (_command, args) => spawnProc(args),
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  emit({ type: "ready" });
  const result = await started;
  assert.equal(result.ok, true);
  for (let i = 0; i < 4; i += 1) await flush();

  return {
    sent,
    fakes,
    get state() {
      return state;
    },
    get ended() {
      return latest().ended;
    },
    run: result.ok ? result.value : (undefined as never),
    exit: () => latest().exit(0),
    emit,
    /** 녹화의 이벤트 줄을 `until`을 만족하는 줄까지(그 줄 포함) 내보낸다. */
    async play(until: (frame: Frame) => boolean) {
      for (; at < rec.length; at += 1) {
        const entry = rec[at];
        if (entry?.kind !== "recv" || entry.data.type === "response") continue;
        const frame = tweak(entry.data);
        emit(frame);
        await flush();
        if (until(frame)) {
          at += 1;
          return;
        }
      }
    },
    input(message: Record<string, unknown>) {
      input({ session: "ses_x", key: "key", ...message } as AcpInput);
      return flush().then(flush).then(flush);
    },
  };
}

const send = (id: string, text: string) => ({
  type: "send",
  id,
  key: id,
  content: [{ type: "text", text }],
  delivery: "next_turn",
});
const isSelect = (frame: Frame) =>
  frame.type === "extension_ui_request" && frame.method === "select";
const uiResponses = (sent: Frame[]) =>
  sent.filter((body) => body.type === "extension_ui_response");
const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));

test("an approval select is not answered until the window decides, and a denial ends the tool as denied", async () => {
  const omp = await setup("approval");
  await omp.input(send("msg_1", "Run `echo one` with the bash tool."));
  await omp.play(isSelect);
  assert.deepEqual(uiResponses(omp.sent), []);
  const first = omp.state.pending.approval;
  assert.deepEqual(first?.subject, { kind: "shell", command: "echo one" });

  await omp.input({
    type: "decide",
    request: first?.id,
    choice: { kind: "once" },
  });
  assert.equal(uiResponses(omp.sent)[0]?.value, "Approve");
  await omp.play((frame) => frame.type === "session_settled");
  assert.equal(omp.state.turn?.phase, "ended");

  await omp.input(send("msg_2", "Run `echo two` with the bash tool."));
  await omp.play(isSelect);
  assert.equal(uiResponses(omp.sent).length, 1);
  await omp.input({
    type: "decide",
    request: omp.state.pending.approval?.id,
    choice: { kind: "reject" },
  });
  assert.equal(uiResponses(omp.sent)[1]?.value, "Deny");
  await omp.play((frame) => frame.type === "session_settled");
  assert.equal(tools(omp.state)[1]?.state, "denied");
  assert.equal(omp.state.turn?.phase, "ended");
});

test("for this session is offered only when omp offers it, and an always choice is never answered as a rule", async () => {
  // 18.8.7의 녹화는 선택지가 Approve, Deny뿐이다.
  const old = await setup("approval");
  await old.input(send("msg_1", "Run `echo one` with the bash tool."));
  await old.play(isSelect);
  assert.deepEqual(old.state.pending.approval?.choices, ["once", "reject"]);
  await old.input({
    type: "decide",
    request: old.state.pending.approval?.id,
    choice: { kind: "always" },
  });
  assert.equal(uiResponses(old.sent)[0]?.value, "Approve");

  // 18.14.2는 세 번째 선택지를 더한다. 같은 녹화의 선택지만 바꾼다.
  const grant = "Approve bash for this session";
  const next = await setup("approval", {
    tweak: (frame) =>
      isSelect(frame)
        ? { ...frame, options: [...(frame.options as string[]), grant] }
        : frame,
  });
  await next.input(send("msg_1", "Run `echo one` with the bash tool."));
  await next.play(isSelect);
  assert.deepEqual(next.state.pending.approval?.choices, [
    "once",
    "session",
    "reject",
  ]);
  await next.input({
    type: "decide",
    request: next.state.pending.approval?.id,
    choice: { kind: "session" },
  });
  assert.equal(uiResponses(next.sent)[0]?.value, grant);
});

test("an ask dialog that arrives before its tool_execution_start lands on the same tool row", async () => {
  const omp = await setup("ask");
  await omp.input(send("msg_1", "Ask me which color I prefer."));
  await omp.play(
    (frame) => frame.type === "extension_ui_request" && frame.method === "ask",
  );
  const asked = omp.state.pending.question;
  assert.equal(asked?.questions?.[0]?.question, "Which color do you prefer?");
  assert.deepEqual(uiResponses(omp.sent), []);

  await omp.play((frame) => frame.type === "tool_execution_start");
  assert.equal(tools(omp.state)[0]?.id, asked?.tool_call);
  await omp.input({
    type: "answer",
    tool_call: asked?.tool_call,
    answers: [
      {
        question: "Which color do you prefer?",
        status: "answered",
        answer: ["red"],
      },
    ],
  });
  assert.deepEqual(uiResponses(omp.sent), [
    {
      type: "extension_ui_response",
      id: uiResponses(omp.sent)[0]?.id,
      answers: [{ id: "color", selectedOptions: ["red"] }],
    },
  ]);
  await omp.play((frame) => frame.type === "session_settled");
  assert.equal(tools(omp.state)[0]?.state, "ok");
  assert.equal(omp.state.pending.question, null);
});

test("an omp that exits before the ready frame is a failed start with its stderr", async () => {
  let err: (text: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  const proc: ExtensionProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {},
    onStdout() {},
    onStderr: (fn) => void (err = fn),
    onExit: (fn) => void (exit = fn),
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const started = createOmpAdapter({ ...noDisk, home: "/home/test" }).start({
    terminal: null,
    cwd: "/work/error",
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
  // 녹화(error)의 stderr: 틀린 flag로 띄우면 ready 전에 1로 끝난다.
  err("--api-key requires a model to be specified via --model\n");
  exit(1);
  const result = await started;
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? "" : result.error.message,
    /--api-key requires a model/,
  );
});

test("a toggle never has two processes on one session", async () => {
  // GUI -> TUI: tuiCommand는 RPC process가 끝난 뒤에야 쓰이므로 stop이 끝날 때까지 process는 살아 있다.
  const omp = await setup("text");
  await omp.play((frame) => frame.type === "agent_end");
  let stopped = false;
  const stopping = omp.run.stop().then(() => void (stopped = true));
  await flush();
  await flush();
  assert.equal(omp.ended, true);
  assert.equal(stopped, false);
  omp.exit();
  await stopping;
  assert.equal(
    omp.run.tuiCommand(),
    "omp --resume=01a1aa91-b251-7356-afc3-f1bdf9f99154",
  );

  // TUI -> GUI: exitTui는 foreground가 끝난 뒤에야 끝나서 그 뒤에야 RPC process를 띄운다.
  let leave: () => void = () => {};
  const signals: string[] = [];
  const terminal = {
    state: () => "idle",
    signal: (signal: string) => void signals.push(signal),
    onForegroundExit: (fn: () => void) => {
      leave = fn;
      return () => {};
    },
  } as unknown as AcpTerminal;
  let exited = false;
  const closing = createOmpAdapter({ ...noDisk, home: "/home/test" })
    .exitTui(terminal)
    .then(() => void (exited = true));
  await flush();
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(exited, false);
  leave();
  await closing;
  assert.equal(exited, true);
});

const types = (sent: Frame[]) => sent.map((body) => body.type);

test("!ls goes to bash and never to the model, and it is only the user's tool line", async () => {
  const omp = await setup("bash");
  await omp.input(send("msg_1", "!ls"));
  assert.deepEqual(
    omp.sent.filter((body) => body.type === "bash"),
    [
      {
        id: omp.sent.find((b) => b.type === "bash")?.id,
        type: "bash",
        command: "ls",
      },
    ],
  );
  assert.equal(types(omp.sent).includes("prompt"), false);
  const line = tools(omp.state)[0];
  assert.equal(line?.by, "user");
  assert.equal(line?.category, "command");
  assert.equal(line?.state, "ok");
  assert.equal(line?.body?.input, "ls");
  assert.equal(line?.body?.output, "hello.txt\n");
  // 사람 말풍선도 turn도 없다: 줄 하나뿐이고 끝 줄(turn_end)이 붙지 않는다.
  assert.equal(line?.turn, null);
  assert.equal(omp.state.turn, null);
  assert.deepEqual(
    omp.state.items.map((item) => item.kind),
    ["tool"],
  );
});

test("opening a session that omp answers with a different session goes back to the earlier one", async () => {
  // 녹화 switch: omp는 없는 file로의 switch_session도 성공으로 답하고 빈 새 session을 연다.
  const head = (id: string) =>
    `${JSON.stringify({ type: "title", title: id, updatedAt: "2026-11-05T10:54:31.129Z" })}\n${JSON.stringify({ type: "session", id, timestamp: "2026-11-05T10:54:31.129Z" })}\n`;
  const first = "01a1ab58-6b07-7741-9074-2dfdaf782f7c";
  const second = "01a1ab58-92d9-7064-bcdf-e61fe3af5292";
  const omp = await setup("switch", {
    folder: { [`a_${first}.jsonl`]: head(first), "b.jsonl": head(second) },
  });
  assert.deepEqual((await omp.run.sessions?.())?.map((one) => one.id).sort(), [
    first,
    second,
  ]);
  await omp.input({ type: "open_session", cli_session: second });
  for (let i = 0; i < 10; i += 1) await flush();
  const switches = omp.sent.filter((body) => body.type === "switch_session");
  // 두 번째 switch가 앞 session의 file로 돌아오는 것이다.
  assert.equal(switches.length, 2);
  // adapter는 node:path로 잇는다(Windows는 `\`).
  assert.equal(switches[0]?.sessionPath, join("/sessions", "b.jsonl"));
  assert.match(String(switches[1]?.sessionPath), /01a1ab58-6b07/);
  assert.equal(
    omp.state.items.some(
      (item) =>
        item.kind === "notice" &&
        item.notice.type === "info" &&
        item.notice.level === "warning",
    ),
    true,
  );
});

test("a session without a model turn is not resumed by the terminal view", async () => {
  const omp = await setup("bash");
  await omp.input(send("msg_1", "!ls"));
  const stopping = omp.run.stop();
  await flush();
  omp.exit();
  await stopping;
  assert.equal(omp.run.tuiCommand(), "omp");
});

test("a command sent while a turn runs is not dropped and its output is outside that turn", async () => {
  const omp = await setup("command_during_turn");
  await omp.input(
    send("msg_1", "Write a numbered list of 60 programming tips."),
  );
  await omp.play((frame) => frame.type === "agent_start");
  const running = omp.state.turn;
  assert.equal(running?.phase, "working");

  await omp.input({ type: "run_command", name: "context", argument: "" });
  const command = omp.sent.filter((body) => body.type === "prompt").at(-1);
  assert.equal(command?.message, "/context");
  assert.equal(command?.streamingBehavior, "followUp");

  await omp.play((frame) => frame.type === "command_output");
  const output = omp.state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "command_output"
      ? [item]
      : [],
  )[0];
  assert.equal(output?.turn, null);
  assert.equal(
    output?.notice.type === "command_output" && output.notice.command,
    "context",
  );
  // ANSI는 지우고 줄은 둔다.
  assert.match(
    output?.notice.type === "command_output" ? output.notice.text : "",
    /^Context window: 1048576 tokens \(1% used\)\n {2}System prompt {4}\[░░░░\] 0%/,
  );
  assert.equal(
    output?.notice.type === "command_output" && output.notice.format,
    "preformatted",
  );
  assert.equal(omp.state.turn?.id, running?.id);
  assert.equal(omp.state.turn?.phase, "working");

  await omp.play((frame) => frame.type === "agent_end");
  assert.equal(omp.state.turn?.phase, "ended");
});

test("roles come from the config files, use_role only sends /switch, and a global slow mode is never touched", async () => {
  const config = `modelRoles:
  smol: test/small:high
  image: test/pixels
`;
  const omp = await setup("switch_role", {
    files: { [join("/home/test", ".omp", "agent", "config.yml")]: config },
    state: {
      fastModeEnabled: false,
      slowModeSupported: true,
      slowModeScope: "global",
      slowModeEnabled: false,
    },
  });
  assert.deepEqual(omp.state.session?.roles, [
    { id: "smol", label: "smol", kind: "chat", model: "test/small:high" },
    { id: "image", label: "image", kind: "model", model: "test/pixels" },
  ]);
  const before = omp.sent.length;
  await omp.input({ type: "use_role", role: "image" });
  await omp.input({ type: "use_role", role: "smol" });
  const current = omp.state.session?.model;
  assert.notEqual(current, undefined);
  await omp.input({
    type: "set_model",
    model: current?.model,
    options: { speed: "slow" },
  });
  const sentSince = omp.sent.slice(before);
  assert.deepEqual(
    sentSince.filter((body) => body.type === "prompt").map((b) => b.message),
    ["/switch @smol"],
  );
  assert.equal(types(sentSince).includes("set_slow_mode"), false);

  // session 범위이면 slow를 낸다.
  const local = await setup("switch_role", {
    state: {
      slowModeSupported: true,
      slowModeScope: "session",
      slowModeEnabled: false,
    },
  });
  await local.input({
    type: "set_model",
    model: local.state.session?.model?.model,
    options: { speed: "slow" },
  });
  assert.equal(types(local.sent).includes("set_slow_mode"), true);
});

test("a task tool line gets its subagent child, the child conversation and a background task", async () => {
  const omp = await setup("subagent_events");
  await omp.input(send("msg_1", "Start one subagent that reads hello.txt."));
  await omp.play((frame) => frame.type === "tool_execution_end");
  // task tool은 띄우자마자 끝나고 subagent는 그 뒤에 알려진다.
  const line = tools(omp.state)[0];
  assert.equal(line?.tool, "task");
  assert.equal(line?.state, "ok");
  assert.equal(line?.detail.kind === "subagent" && line.detail.child, null);

  await omp.play(
    (frame) =>
      frame.type === "subagent_lifecycle" &&
      (frame.payload as Frame).status === "completed",
  );
  const detail = tools(omp.state)[0]?.detail;
  assert.equal(detail?.kind === "subagent" && detail.child, "ReadHello");
  assert.equal(detail?.kind === "subagent" && detail.state, "done");
  assert.equal(detail?.kind === "subagent" && detail.model, "test/base:high");
  const child = omp.state.children.ReadHello;
  assert.equal(
    child?.items.some(
      (item) => item.kind === "message" && item.actor === "received",
    ),
    true,
  );
  assert.equal(
    child?.items.some(
      (item) =>
        item.kind === "message" &&
        item.actor === "user" &&
        item.delivery === "steer",
    ),
    true,
  );
  assert.deepEqual(
    child?.items.flatMap((item) => (item.kind === "tool" ? [item.tool] : [])),
    ["read", "bash", "yield"],
  );
  assert.deepEqual(
    omp.state.tasks.map((task) => [task.id, task.state]),
    [["ReadHello", "done"]],
  );

  // 멈춤과 방향 주기는 omp의 subagent RPC로 간다.
  await omp.input({ type: "stop_child", child: "ReadHello" });
  await omp.input({ type: "steer_child", child: "ReadHello", text: "hurry" });
  assert.deepEqual(
    omp.sent
      .filter(
        (b) => b.type === "cancel_subagent" || b.type === "steer_subagent",
      )
      .map((b) => [b.type, b.subagentId]),
    [
      ["cancel_subagent", "ReadHello"],
      ["steer_subagent", "ReadHello"],
    ],
  );
});

test("changing the approval mode ends the old process before the new one takes the session", async () => {
  const omp = await setup("text");
  await omp.play((frame) => frame.type === "agent_end");
  const changing = omp.input({ type: "set_mode", mode: "write" });
  await flush();
  assert.equal(omp.ended, true);
  assert.equal(omp.fakes.length, 1);

  omp.exit();
  await flush();
  await flush();
  assert.equal(omp.fakes.length, 2);
  assert.deepEqual(omp.fakes[1]?.args, [
    "--mode",
    "rpc-ui",
    "--cwd=/work/text",
    "--resume=01a1aa91-b251-7356-afc3-f1bdf9f99154",
    "--approval-mode=write",
  ]);
  omp.emit({ type: "ready" });
  for (let i = 0; i < 10; i += 1) await flush();
  await changing;
  assert.equal(omp.state.session?.mode, "write");
  assert.equal(
    omp.run.tuiCommand(),
    "omp --resume=01a1aa91-b251-7356-afc3-f1bdf9f99154 --approval-mode=write",
  );
});
