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
// 답하지 않으며, `ask`는 질문이 tool 줄보다 먼저 와도 같은 줄에 붙고, toggle은 한 session에 두 process를 같이 쥐지 않는다.

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
]);

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(name: string, tweak: (frame: Frame) => Frame = (f) => f) {
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
  let out: (text: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  let ended = false;
  const emit = (frame: Frame) => out(`${JSON.stringify(frame)}\n`);
  const proc: ExtensionProcess = {
    pid: 1,
    write(text) {
      const body = JSON.parse(text) as Frame;
      sent.push(body);
      const type = body.type as string;
      if (type === "extension_ui_response") return;
      const list = answers.get(type) ?? [];
      const recorded = list.length > 1 ? list.shift() : list[0];
      setImmediate(() =>
        emit(
          recorded === undefined
            ? {
                type: "response",
                id: body.id,
                command: type,
                success: true,
                data: FALLBACK[type],
              }
            : { ...recorded, id: body.id },
        ),
      );
    },
    end: () => void (ended = true),
    kill() {},
    onStdout: (fn) => void (out = fn),
    onStderr() {},
    onExit: (fn) => void (exit = fn),
  };

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
    readFile: () => Promise.reject(new Error("no files")),
  }).start({
    terminal: null,
    cwd: `/work/${name}`,
    session,
    spawn: () => proc,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  emit({ type: "ready" });
  const result = await started;
  assert.equal(result.ok, true);
  await flush();
  await flush();

  return {
    sent,
    get state() {
      return state;
    },
    get ended() {
      return ended;
    },
    run: result.ok ? result.value : (undefined as never),
    exit: () => exit(0),
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
    async input(message: Record<string, unknown>) {
      input({ session: "ses_x", ...message } as AcpInput);
      await flush();
      await flush();
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
  const next = await setup("approval", (frame) =>
    isSelect(frame)
      ? { ...frame, options: [...(frame.options as string[]), grant] }
      : frame,
  );
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
  const started = createOmpAdapter({
    readFile: () => Promise.reject(new Error("no files")),
  }).start({
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
  const closing = createOmpAdapter({
    readFile: () => Promise.reject(new Error("no files")),
  })
    .exitTui(terminal)
    .then(() => void (exited = true));
  await flush();
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(exited, false);
  leave();
  await closing;
  assert.equal(exited, true);
});
