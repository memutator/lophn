import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../base/clock.ts";
import { createIdSource } from "../../base/id.ts";
import { seededRandom } from "../../base/random.ts";
import type { AcpInput } from "../../protocol/acp/input.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import type { AcpState } from "../../protocol/acp/state.ts";
import type { AcpSessionHandle, CliProcess } from "../../protocol/acp/mod.ts";
import { createAntigravityAdapter } from "./antigravity.ts";

// 녹화(fixtures/antigravity, agy 1.5.9)로 adapter를 돌린다. 진짜 agy는 띄우지 않고, spawn이 주는 process를 녹화한 줄을 내는
// 대역으로 바꾼다. 시작 요청(initialize, session/new·load, 설정)의 답은 녹화의 같은 요청 자리에서 이어지는 줄까지 자동으로 내고,
// prompt 뒤의 줄은 test가 `play`로 원하는 자리까지만 내보낸다. 위험한 규칙만 본다: 승인과 질문은 사람이 정하기 전에는 답하지 않고
// 정한 값(optionId, 칸 이름)으로만 답하며 멈추면 열린 요청을 취소로 답하고, steer는 바로 보내져도 ACP turn은 마지막 prompt가
// 답할 때 한 번만 끝나고, 저장되지 않은 대화는 실패 없이 새 대화로 열리고, TUI로 넘길 때는 GUI에서 바꾼 값만 싣는다.

type Frame = Record<string, unknown>;
type Entry = { kind: string; data: Frame };
const fixtures = fileURLToPath(
  new URL("./fixtures/antigravity/", import.meta.url),
);
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(
  name: string,
  options: {
    resume?: string;
    args?: readonly string[];
    carry?: { args?: readonly string[] };
    /** 대화 file이 있는 id. 없으면 저장된 적 없는 대화다. */
    saved?: string[];
    /** 설정 요청의 답을 바꾼다. */
    answer?: (method: string, params: Frame) => Frame | undefined;
  } = {},
) {
  const rec = recording(name);
  const sendsOf = (method: string) =>
    rec.flatMap((entry, at) =>
      entry.kind === "send" && entry.data.method === method ? [at] : [],
    );
  const written: Frame[] = [];
  const counts = new Map<string, number>();
  let cursor = 0;
  let out: (text: string) => void = () => {};
  const emit = (frame: Frame) =>
    out(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);

  // 녹화에서 받은 답(id는 녹화의 것)을 adapter가 보낸 같은 종류 요청 중 같은 차례의 id로 바꾼다.
  const ourId = (recorded: unknown) => {
    const at = rec.findIndex(
      (entry) => entry.kind === "send" && entry.data.id === recorded,
    );
    const method = rec[at]?.data.method as string;
    const nth = sendsOf(method).indexOf(at);
    return written.filter((body) => body.method === method)[nth]?.id;
  };
  const replay = (entry: Entry) => {
    const frame = entry.data;
    if (frame.method === undefined && frame.id !== undefined) {
      const id = ourId(frame.id);
      if (id !== undefined) emit({ ...frame, id });
    } else emit(frame);
  };

  const proc: CliProcess = {
    pid: 1,
    write(text) {
      const body = JSON.parse(text) as Frame;
      written.push(body);
      const method = body.method as string | undefined;
      if (method === undefined || body.id === undefined) return;
      const nth = counts.get(method) ?? 0;
      counts.set(method, nth + 1);
      const at = sendsOf(method)[nth];
      if (method === "session/prompt") {
        if (at !== undefined) cursor = Math.max(cursor, at + 1);
        return;
      }
      const custom = options.answer?.(method, body.params as Frame);
      setImmediate(() => {
        if (custom !== undefined) return emit({ id: body.id, result: custom });
        if (at === undefined) return emit({ id: body.id, result: {} });
        // 그 요청 뒤 다음 보낸 줄 전까지(답 앞의 흘러나온 갱신, 답, 뒤따르는 갱신)를 낸다.
        let next = at + 1;
        for (; rec[next]?.kind === "recv"; next += 1)
          replay(rec[next] as Entry);
        cursor = Math.max(cursor, next);
      });
    },
    end() {},
    kill() {},
    onStdout: (fn) => void (out = fn),
    onStderr() {},
    onExit() {},
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
  const checked: string[] = [];
  const spawned: { command: string; args: readonly string[] }[] = [];
  const started = createAntigravityAdapter({
    home: "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists(path) {
      checked.push(path);
      return Promise.resolve(
        (options.saved ?? []).some((id) => path.endsWith(`/${id}.db`)),
      );
    },
  }).start({
    terminal: null,
    cwd: `/work/${name}`,
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    ...(options.args === undefined ? {} : { args: options.args }),
    ...(options.carry === undefined ? {} : { carry: options.carry }),
    session,
    spawn: (command, args) => {
      spawned.push({ command, args });
      return proc;
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const result = await started;
  assert.equal(result.ok, true);
  for (let i = 0; i < 4; i += 1) await flush();

  return {
    written,
    checked,
    spawned,
    get state() {
      return state;
    },
    run: result.ok ? result.value : (undefined as never),
    /** 녹화의 받은 줄(답이 아닌 것과 prompt의 답)을 `until`을 만족하는 줄까지(그 줄 포함) 내보낸다. */
    async play(until: (frame: Frame) => boolean) {
      for (; cursor < rec.length; cursor += 1) {
        const entry = rec[cursor];
        if (entry?.kind !== "recv") continue;
        replay(entry);
        await flush();
        if (until(entry.data)) {
          cursor += 1;
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

const send = (id: string, text: string, delivery = "next_turn") => ({
  type: "send",
  id,
  key: id,
  content: [{ type: "text", text }],
  delivery,
});
const update = (frame: Frame) =>
  (frame.params as Frame | undefined)?.update as Frame | undefined;
const isMethod = (method: string) => (frame: Frame) => frame.method === method;
const isReply = (frame: Frame) =>
  frame.method === undefined &&
  (frame.result as Frame)?.stopReason !== undefined;
const answered = (written: Frame[], id: unknown) =>
  written.filter((body) => body.id === id && body.result !== undefined);
const sessionCalls = (written: Frame[]) =>
  written.flatMap((body) =>
    typeof body.method === "string" && body.method.startsWith("session/")
      ? [body.method]
      : [],
  );
const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));

test("an approval is answered only after the person decides, with the option they chose", async () => {
  const agy = await setup("deny");
  await agy.input(send("msg_1", "Run the shell command `echo denied-test`."));
  await agy.play(isMethod("session/request_permission"));
  // agy가 기다리는 요청이다. 사람이 정하기 전에 답하면 자동 승인이 된다.
  assert.deepEqual(answered(agy.written, "1"), []);
  const card = agy.state.pending.approval;
  assert.deepEqual(card?.subject, {
    kind: "shell",
    command: "echo denied-test",
  });
  assert.deepEqual(card?.choices, ["once", "reject"]);

  await agy.input({
    type: "decide",
    request: card?.id,
    choice: { kind: "reject" },
  });
  assert.deepEqual(answered(agy.written, "1")[0]?.result, {
    outcome: { outcome: "selected", optionId: "deny" },
  });
  await agy.play(isReply);
  assert.equal(tools(agy.state)[0]?.state, "denied");
  assert.equal(agy.state.turn?.phase, "ended");

  const allow = await setup("deny");
  await allow.input(send("msg_1", "Run the shell command `echo denied-test`."));
  await allow.play(isMethod("session/request_permission"));
  await allow.input({
    type: "decide",
    request: allow.state.pending.approval?.id,
    choice: { kind: "once" },
  });
  assert.deepEqual(answered(allow.written, "1")[0]?.result, {
    outcome: { outcome: "selected", optionId: "allow" },
  });
});

test("stopping a turn answers an open approval as cancelled and tells agy to cancel", async () => {
  const agy = await setup("cancel");
  await agy.input(
    send("msg_1", "Run the shell command `sleep 30` and then say done."),
  );
  await agy.play(isMethod("session/request_permission"));
  await agy.input({ type: "stop", turn: agy.state.turn?.id });
  assert.deepEqual(answered(agy.written, "1")[0]?.result, {
    outcome: { outcome: "cancelled" },
  });
  assert.equal(
    agy.written.some(
      (body) => body.method === "session/cancel" && body.id === undefined,
    ),
    true,
  );
  assert.equal(agy.state.pending.approval, null);
  // 취소가 끝나기 전에 보낸 말은 agy가 거절하므로 줄에 세워 둔다.
  await agy.input(send("msg_2", "Reply with exactly: ok"));
  assert.equal(
    agy.written.filter((body) => body.method === "session/prompt").length,
    1,
  );
  assert.equal(agy.state.queued.length, 1);
  await agy.play(isReply);
  await flush();
  assert.equal(
    agy.written.filter((body) => body.method === "session/prompt").length,
    2,
  );
});

test("a question card goes back under its form property names, free text under the _other name", async () => {
  for (const [reply, content] of [
    [["Spaces"], { q1: "2" }],
    [["both, per file"], { q1_other: "both, per file" }],
  ] as const) {
    const agy = await setup("question");
    await agy.input(send("msg_1", "Ask me whether I prefer tabs or spaces."));
    await agy.play(isMethod("elicitation/create"));
    const asked = agy.state.pending.question;
    assert.deepEqual(
      asked?.questions?.[0]?.options.map((option) => option.label),
      ["Tabs", "Spaces"],
    );
    assert.deepEqual(answered(agy.written, "1"), []);

    await agy.input({
      type: "answer",
      tool_call: asked?.tool_call,
      answers: [
        {
          question: asked?.questions?.[0]?.question,
          status: "answered",
          answer: [...reply],
        },
      ],
    });
    assert.deepEqual(answered(agy.written, "1")[0]?.result, {
      action: "accept",
      content,
    });
    assert.equal(agy.state.pending.question, null);
  }
});

test("a steer goes out at once and the ACP turn ends once, after the second prompt replies", async () => {
  const agy = await setup("steer");
  await agy.input(
    send("msg_1", "Run the shell command `sleep 10`, then reply 'first done'."),
  );
  await agy.play(isMethod("session/request_permission"));
  await agy.input({
    type: "decide",
    request: agy.state.pending.approval?.id,
    choice: { kind: "once" },
  });
  await agy.play((frame) => update(frame)?.status === "in_progress");

  await agy.input(
    send("msg_2", "Also end your reply with the word banana.", "steer"),
  );
  assert.equal(
    agy.written.filter((body) => body.method === "session/prompt").length,
    2,
  );
  assert.equal(agy.state.queued[0]?.id, "msg_2");

  // 첫 prompt의 답이 먼저 오지만 agy는 같은 일을 이어 가므로 turn은 열려 있다.
  await agy.play(isReply);
  assert.equal(agy.state.turn?.phase, "working");
  await agy.play(isReply);
  assert.equal(agy.state.turn?.phase, "ended");
  assert.equal(agy.state.queued.length, 0);
  const ends = agy.state.items.filter(
    (item) => item.kind === "notice" && item.notice.type === "turn_end",
  );
  assert.equal(ends.length, 1);
  const users = agy.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item] : [],
  );
  assert.deepEqual(
    users.map((item) => [item.id, item.delivery]),
    [
      ["msg_1", "next_turn"],
      ["msg_2", "steer"],
    ],
  );
});

test("a conversation without a saved file opens as a new session, and a saved one draws its replay", async () => {
  const fresh = await setup("text", {
    resume: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(sessionCalls(fresh.written), ["session/new"]);
  assert.deepEqual(fresh.state.items, []);
  assert.equal(fresh.run.sessionId(), "d1fb45c2-7787-48fa-8857-7b99e57222f7");

  const saved = "26e8bf45-50c5-4e72-b332-855cf6cff86e";
  const agy = await setup("load", { resume: saved, saved: [saved] });
  assert.equal(
    agy.checked[0],
    `/home/test/.gemini/antigravity-cli/conversations/${saved}.db`,
  );
  assert.deepEqual(sessionCalls(agy.written), ["session/load"]);
  assert.deepEqual(
    agy.state.items.map((item) =>
      item.kind === "message" ? `${item.actor}` : item.kind,
    ),
    ["user", "tool", "tool", "tool", "tool", "agent", "notice"],
  );
  assert.deepEqual(
    tools(agy.state).map((item) => item.state),
    ["ok", "ok", "ok", "ok"],
  );
  // 다시 연 title은 `File ../x/notes.txt`일 수 있다. 편집 줄의 이름은 경로에서 만든다.
  const edit = tools(agy.state)[2]?.detail;
  assert.deepEqual(
    edit?.kind === "edit" ? [edit.document, edit.added, edit.removed] : null,
    ["/tmp/agy-rec-dBKOEa/notes.txt", 1, 1],
  );
  assert.equal(agy.state.turn?.phase, "ended");
  assert.equal(agy.state.session?.cli_session, saved);
  assert.equal(
    agy.state.session?.title,
    "Execute Shell Commands And File Operations",
  );
});

test("the TUI command resumes the conversation and carries only what the GUI changed", async () => {
  const configs = structuredClone(
    (recording("text")[3]?.data.result as Frame).configOptions as Frame[],
  );
  const agy = await setup("text", {
    answer(method, params) {
      if (method === "session/set_config_option") {
        const one = configs.find((it) => it.id === params.configId);
        if (one !== undefined) one.currentValue = params.value;
        return { configOptions: configs };
      }
      return method === "session/set_mode" ? {} : undefined;
    },
  });
  const id = "d1fb45c2-7787-48fa-8857-7b99e57222f7";
  assert.equal(agy.run.tuiCommand(), `agy --conversation ${id}`);

  await agy.input({
    type: "set_model",
    model: "gemini-3.8-flash",
    options: { effort: "low" },
  });
  // agy는 `--model <legacy id>`와 `--effort`를 같이 받으면 거절하므로 단계는 id에 싣는다.
  assert.equal(
    agy.run.tuiCommand(),
    `agy --conversation ${id} --model gemini-3.8-flash-low`,
  );

  await agy.input({ type: "set_mode", mode: "plan" });
  assert.equal(
    agy.run.tuiCommand(),
    `agy --conversation ${id} --model gemini-3.8-flash-low --mode plan`,
  );
});

test("explicit CLI flags are preserved across agy acp spawn, tuiCommand, and carry", async () => {
  const id = "d1fb45c2-7787-48fa-8857-7b99e57222f7";
  const direct = await setup("text", {
    args: ["--dangerously-skip-permissions", "--add-dir", "/extra"],
  });
  assert.deepEqual(direct.spawned, [
    {
      command: "agy",
      args: ["acp", "--dangerously-skip-permissions", "--add-dir", "/extra"],
    },
  ]);
  assert.equal(
    direct.run.tuiCommand(),
    `agy --conversation ${id} --dangerously-skip-permissions --add-dir /extra`,
  );
  assert.deepEqual(direct.run.carry?.(), {
    args: ["--dangerously-skip-permissions", "--add-dir", "/extra"],
  });

  // carry가 있고 args가 생략되면 이어 간다.
  const carried = await setup("text", {
    carry: { args: ["--dangerously-skip-permissions"] },
  });
  assert.deepEqual(carried.spawned, [
    { command: "agy", args: ["acp", "--dangerously-skip-permissions"] },
  ]);

  // TUI가 flag 없이 떴으면(args: []) 이전 carry를 덮어쓴다.
  const plain = await setup("text", {
    args: [],
    carry: { args: ["--dangerously-skip-permissions"] },
  });
  assert.deepEqual(plain.spawned, [{ command: "agy", args: ["acp"] }]);
  assert.equal(plain.run.tuiCommand(), `agy --conversation ${id}`);
  assert.deepEqual(plain.run.carry?.(), {});
});
