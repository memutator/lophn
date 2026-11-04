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
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import { opencodeAdapter } from "./opencode.ts";

// 녹화(fixtures/opencode)로 adapter를 돌린다. 실제 `opencode`는 띄우지 않고, spawn이 주는 process를 녹화한 서버 쪽 줄을
// 내보내는 대역으로 바꾼다. adapter가 쓴 줄은 녹화한 클라이언트 쪽 줄과 같아야 한다.

type Entry = { kind: "send" | "recv"; data: Record<string, unknown> };
const fixtures = fileURLToPath(
  new URL("./fixtures/opencode/", import.meta.url),
);
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const promptText = (rec: Entry[], nth = 0) =>
  (
    rec.filter((entry) => entry.data.method === "session/prompt")[nth]?.data
      .params as { prompt: { text: string }[] }
  ).prompt[0]?.text as string;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(name: string, options: { resume?: string } = {}) {
  const rec = recording(name);
  const written: unknown[] = [];
  let out: (text: string) => void = () => {};
  const proc: ExtensionProcess = {
    pid: 1,
    write: (text) => void written.push(JSON.parse(text)),
    end() {},
    kill() {},
    onStdout: (fn) => void (out = fn),
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
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const started = await opencodeAdapter.start({
    cwd: `/work/${name}`,
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    session,
    spawn: () => proc,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  assert.equal(started.ok, true);

  let at = 0;
  let checked = 0;
  return {
    rec,
    written,
    get state() {
      return state;
    },
    /**
     * 녹화를 따라간다. 서버 쪽 줄은 내보내고 클라이언트 쪽 줄은 adapter가 이미 썼는지 본다.
     * 아직 안 썼으면(창의 입력을 기다린다) 멈춘다.
     */
    async pump() {
      for (;;) {
        await flush();
        const entry = rec[at];
        if (entry === undefined) return;
        if (entry.kind === "recv") {
          out(`${JSON.stringify(entry.data)}\n`);
        } else if (written.length > checked) {
          assert.deepEqual(written[checked++], entry.data);
        } else {
          return;
        }
        at += 1;
      }
    },
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

const contiguous = (state: AcpState) => {
  const seqs = state.items.map((item) => item.seq);
  assert.deepEqual(
    seqs,
    seqs.map((_, index) => index + 1),
  );
};
const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));
const ends = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );

const approvalRows = [
  { name: "approve", choice: { kind: "once" }, tool: "ok", turn: "completed" },
  { name: "deny", choice: { kind: "reject" }, tool: "denied", turn: "stopped" },
] as const;

for (const row of approvalRows) {
  test(`permission 요청은 창이 답하기 전까지 tool을 실행하지 않고 답대로 끝난다 (${row.name})`, async () => {
    const t = await setup(row.name);
    await t.pump();
    await t.input(t.send("1", promptText(t.rec)));
    await t.pump();

    // 창이 답하기 전: 답을 쓰지 않았고(OpenCode는 답을 받아야 tool을 실행한다) 카드가 떠 있다.
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.deepEqual(approval.subject.kind, "shell");
    // OpenCode의 always는 사람의 project에 영구히 저장되므로 이 session 동안 선택지로 내놓지 않는다.
    assert.deepEqual(approval.always_patterns, []);
    assert.equal(t.state.turn?.phase, "waiting");
    assert.equal(tools(t.state)[0]?.state, "running");
    assert.ok(
      !t.written.some((line) => (line as { id?: number }).id === 0),
      "no permission reply yet",
    );

    await t.input({ type: "decide", request: approval.id, choice: row.choice });
    await t.pump();

    assert.equal(tools(t.state)[0]?.state, row.tool);
    assert.equal(t.state.pending.approval, null);
    assert.deepEqual(ends(t.state), [row.turn]);
    assert.equal(t.state.reread, false);
    contiguous(t.state);
  });
}

test("도는 중 보낸 메시지는 줄을 서고, stop은 session/cancel이며, 끝난 뒤 다음 prompt로 간다", async () => {
  const t = await setup("cancel");
  await t.pump();
  await t.input(t.send("1", promptText(t.rec)));
  await t.pump();
  assert.equal(t.state.turn?.phase, "working");

  await t.input(t.send("2", "second"));
  assert.equal(t.state.queued.length, 1);
  assert.equal(t.written.length, 3);

  await t.input({ type: "stop", turn: "trn_x", key: "stop" });
  await t.pump();

  assert.deepEqual(ends(t.state), ["stopped"]);
  assert.equal(t.state.queued.length, 0);
  assert.deepEqual(
    (t.written.at(-1) as { params: { prompt: unknown[] } }).params.prompt,
    [{ type: "text", text: "second" }],
  );
  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.id] : [],
  );
  assert.deepEqual(users, ["msg_1", "msg_2"]);
  contiguous(t.state);
});

test("session/load가 다시 흘린 앞 대화를 그리고 이어서 보낸다", async () => {
  const t = await setup("load", { resume: "ses_e592c5dceffeeOvDkGApBzT68M" });
  await t.pump();
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

  await t.input(t.send("1", promptText(t.rec)));
  await t.pump();
  assert.deepEqual(ends(t.state), ["completed", "completed"]);
  assert.equal(t.state.reread, false);
  contiguous(t.state);
});
