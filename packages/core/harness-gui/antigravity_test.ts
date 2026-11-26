import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../base/clock.ts";
import { createIdSource } from "../../base/id.ts";
import { seededRandom } from "../../base/random.ts";
import type { AcpInput } from "../../protocol/acp/input.ts";
import {
  type AcpSessionHandle,
  type CliProcess,
  withoutToolBodies,
} from "../../protocol/acp/mod.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import {
  type AcpState,
  acpStateSchema,
  type AcpUpdate,
} from "../../protocol/acp/state.ts";
import { type AntigravityIo, createAntigravityAdapter } from "./antigravity.ts";

// 녹화(fixtures/antigravity, agy 1.5.9)로 adapter를 돌린다. 진짜 agy는 띄우지 않고, spawn이 주는 process를 녹화한 줄을 내는
// 대역으로 바꾼다. 시작 요청(initialize, session/new·load, 설정)의 답은 녹화의 같은 요청 자리에서 이어지는 줄까지 자동으로 내고,
// prompt 뒤의 줄은 test가 `play`로 원하는 자리까지만 내보낸다.

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
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type CommittableSession = AcpSessionHandle & {
  commit?(updates: readonly AcpUpdate[]): void;
};

async function setup(
  name: string,
  options: {
    resume?: string;
    args?: readonly string[];
    carry?: { args?: readonly string[]; model?: string; effort?: string };
    launch?: { model?: string; options?: Record<string, string> };
    /** 대화 file이 있는 id. 없으면 저장된 적 없는 대화다. */
    saved?: string[];
    /** 설정 요청의 답을 바꾼다. */
    answer?: (method: string, params: Frame) => Frame | undefined;
    /** Provide atomic session.commit() on the handle and record calls. */
    withCommit?: boolean;
    home?: string;
    io?: Partial<AntigravityIo>;
    /** Override initialize response fields (e.g. agentInfo.version). */
    initOverride?: (result: Frame) => Frame;
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
  let onExitFn: (code: number | null) => void = () => {};
  const emit = (frame: Frame) =>
    out(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);

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
      if (id !== undefined) {
        const result =
          options.initOverride !== undefined &&
          (frame.result as Frame | undefined)?.agentInfo !== undefined
            ? options.initOverride(structuredClone(frame.result as Frame))
            : frame.result;
        emit({ ...frame, id, result });
      }
    } else emit(frame);
  };

  function makeProc(): CliProcess {
    return {
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
          if (custom !== undefined)
            return emit({ id: body.id, result: custom });
          if (at === undefined) return emit({ id: body.id, result: {} });
          let next = at + 1;
          for (; rec[next]?.kind === "recv"; next += 1)
            replay(rec[next] as Entry);
          cursor = Math.max(cursor, next);
        });
      },
      end() {},
      kill() {
        setImmediate(() => onExitFn(null));
      },
      onStdout: (fn) => void (out = fn),
      onStderr() {},
      onExit: (fn) => void (onExitFn = fn),
    };
  }

  let state: AcpState = EMPTY_ACP_STATE;
  let input: (message: AcpInput) => void = () => {};
  const published: AcpUpdate[] = [];
  const commits: (readonly AcpUpdate[])[] = [];
  const session: CommittableSession = {
    id: "win_test",
    publish(update) {
      published.push(update);
      state = reduceAcp(state, update);
    },
    ...(options.withCommit
      ? {
          commit(updates: readonly AcpUpdate[]) {
            commits.push(updates);
            for (const update of updates) {
              state = reduceAcp(state, update);
            }
          },
        }
      : {}),
    onInput: (fn) => void (input = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const checked: string[] = [];
  const spawned: { command: string; args: readonly string[] }[] = [];
  const started = createAntigravityAdapter({
    home: options.home ?? "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists(path) {
      checked.push(path);
      return Promise.resolve(
        (options.saved ?? []).some((id) => path.endsWith(`/${id}.db`)),
      );
    },
    loadReplayQuietPeriodMs: options.io?.loadReplayQuietPeriodMs ?? 20,
    stopTimeouts: { cancelMs: 20, closeMs: 20, exitMs: 20 },
    ...options.io,
  }).start({
    terminal: null,
    cwd: `/work/${name}`,
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    ...(options.args === undefined ? {} : { args: options.args }),
    ...(options.carry === undefined ? {} : { carry: options.carry }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    session,
    spawn: (command, args) => {
      spawned.push({ command, args });
      return makeProc();
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
    published,
    commits,
    emit,
    crash: (code: number | null = 1) => onExitFn(code),
    get state() {
      return state;
    },
    run: result.ok ? result.value : (undefined as never),
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
const userMessages = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item] : [],
  );

// --- Core approval / question / cancel / TUI / catalog tests (preserved) ---

test("an approval is answered only after the person decides, with the option they chose", async () => {
  const agy = await setup("deny");
  await agy.input(send("msg_1", "Run the shell command `echo denied-test`."));
  await agy.play(isMethod("session/request_permission"));
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

// --- Steer & echo-independence tests (Spec 3.1) ---

test("steer owns the user message immediately without waiting for echo and ends turn once after second prompt", async () => {
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
  // Dispatched immediately AND placed in timeline immediately (NOT stuck in queue).
  assert.equal(
    agy.written.filter((body) => body.method === "session/prompt").length,
    2,
  );
  assert.equal(agy.state.queued.length, 0);
  assert.deepEqual(
    userMessages(agy.state).map((item) => [item.id, item.delivery]),
    [
      ["msg_1", "next_turn"],
      ["msg_2", "steer"],
    ],
  );

  // First prompt replies end_turn while second prompt is still outstanding: turn stays working.
  await agy.play(isReply);
  assert.equal(agy.state.turn?.phase, "working");

  // Second prompt runs through user_message_chunk echo (must be ignored!) and ends turn once.
  await agy.play(isReply);
  assert.equal(agy.state.turn?.phase, "ended");
  assert.equal(agy.state.queued.length, 0);
  const ends = agy.state.items.filter(
    (item) => item.kind === "notice" && item.notice.type === "turn_end",
  );
  assert.equal(ends.length, 1);
  // Still exactly 2 user messages (no duplicate from user_message_chunk echo).
  assert.deepEqual(
    userMessages(agy.state).map((item) => [item.id, item.delivery]),
    [
      ["msg_1", "next_turn"],
      ["msg_2", "steer"],
    ],
  );
});

test("send_queued promotes immediately via message_taken(steer), live user_message_chunk is unconditionally ignored, and agy < 1.5.0 disables steer capability", async () => {
  const agy = await setup("text");
  await agy.input(send("msg_1", "first"));
  // Queue a second message while turn is working.
  await agy.input(send("msg_2", "second", "next_turn"));
  assert.equal(agy.state.queued.length, 1);

  // Promote queued item to steer -> immediately leaves queue and joins items as steer.
  await agy.input({ type: "send_queued", message: "msg_2" });
  assert.equal(agy.state.queued.length, 0);
  assert.deepEqual(
    userMessages(agy.state).map((m) => [m.id, m.delivery]),
    [
      ["msg_1", "next_turn"],
      ["msg_2", "steer"],
    ],
  );

  // Even a mangled/unrelated live user_message_chunk echo is ignored unconditionally.
  agy.emit({
    method: "session/update",
    params: {
      sessionId: agy.run.sessionId(),
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "completely different echoed text" },
      },
    },
  });
  await flush();
  assert.equal(userMessages(agy.state).length, 2);

  // Reject the second (steer) prompt -> must re-queue at front with same id and auto-send on turn end.
  const promptIds = agy.written
    .filter((b) => b.method === "session/prompt")
    .map((b) => b.id);
  agy.emit({
    id: promptIds[1],
    error: { code: -32000, message: "steer declined: turn completing" },
  });
  await flush();
  // First prompt finishes -> auto-dispatches re-queued msg_2 without duplicating it in items.
  agy.emit({ id: promptIds[0], result: { stopReason: "end_turn" } });
  await flush();
  await flush();
  assert.equal(
    agy.written.filter((b) => b.method === "session/prompt").length,
    3,
  );
  assert.equal(userMessages(agy.state).length, 2);

  // agy < 1.5.0 disables steer capability (queue only).
  const oldAgy = await setup("text", {
    initOverride: (result) => ({
      ...result,
      agentInfo: { name: "Antigravity ACP Server", version: "1.4.9" },
    }),
  });
  assert.equal(oldAgy.state.session?.capabilities.steer, false);
  await oldAgy.input(send("msg_1", "first"));
  await oldAgy.input(send("msg_2", "try steer on old agy", "steer"));
  assert.equal(
    oldAgy.written.filter((b) => b.method === "session/prompt").length,
    1,
  );
  assert.equal(oldAgy.state.queued.length, 1);
});

// --- Replay zero-leak + atomic commit + skipping_late_replay + revive ---

test("session/load replay is zero-leak (no writing_streamed, single atomic commit) and drops late replay chunks before first live prompt", async () => {
  const fresh = await setup("text", {
    resume: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(sessionCalls(fresh.written), ["session/new"]);
  assert.deepEqual(fresh.state.items, []);
  assert.equal(fresh.run.sessionId(), "d1fb45c2-7787-48fa-8857-7b99e57222f7");

  const saved = "26e8bf45-50c5-4e72-b332-855cf6cff86e";
  const agy = await setup("load", {
    resume: saved,
    saved: [saved],
    withCommit: true,
  });
  assert.equal(
    agy.checked[0],
    `/home/test/.gemini/antigravity-cli/conversations/${saved}.db`,
  );
  assert.deepEqual(sessionCalls(agy.written), ["session/load"]);
  // Zero live publish calls during load/draining; single atomic commit!
  assert.equal(agy.published.length, 0);
  assert.equal(agy.commits.length, 1);
  // Zero writing_streamed updates in the committed snapshot!
  assert.equal(
    agy.commits[0]?.some((u) => u.type === "writing_streamed"),
    false,
  );
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

  // In skipping_late_replay: late conversation chunk is dropped, metadata passes through.
  const itemCountBefore = agy.state.items.length;
  agy.emit({
    method: "session/update",
    params: {
      sessionId: saved,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late stale replay chunk" },
      },
    },
  });
  agy.emit({
    method: "session/update",
    params: {
      sessionId: saved,
      update: {
        sessionUpdate: "session_info_update",
        title: "Updated Metadata Title",
      },
    },
  });
  await flush();
  assert.equal(agy.state.items.length, itemCountBefore);
  assert.equal(agy.state.writing, null);
  assert.equal(agy.state.session?.title, "Updated Metadata Title");
});

test("revive after crash prefers session/resume in discard mode and keeps existing items intact", async () => {
  const saved = "d1fb45c2-7787-48fa-8857-7b99e57222f7";
  let initCount = 0;
  const agy = await setup("text", {
    saved: [saved],
    answer: (method) => {
      if (method === "initialize") {
        initCount += 1;
        if (initCount > 1) {
          return {
            protocolVersion: 1,
            agentInfo: { name: "Antigravity ACP Server", version: "1.5.9" },
            agentCapabilities: {
              loadSession: true,
              sessionCapabilities: { resume: {}, load: {}, close: {} },
            },
          };
        }
      }
      if (method === "session/resume") {
        return { sessionId: saved, configOptions: [] };
      }
      return undefined;
    },
  });
  await agy.input(send("msg_1", "hello"));
  const p1 = agy.written.find((b) => b.method === "session/prompt")?.id;
  agy.emit({ id: p1, result: { stopReason: "end_turn" } });
  await flush();
  const countBeforeCrash = agy.state.items.length;

  // Crash process and send another message -> should revive via session/resume (NOT session/load).
  agy.crash(1);
  await flush();
  await agy.input(send("msg_2", "after revive"));
  assert.equal(
    agy.written.some((b) => b.method === "session/resume"),
    true,
  );
  assert.equal(
    agy.written.some((b) => b.method === "session/load"),
    false,
  );
  assert.equal(agy.state.items.length >= countBeforeCrash + 1, true);
});

// --- 3-way Slash Commands & withheldCommands (Spec 4.1) ---

test("slash commands: /swarm recorded as user message & queue-forced, /compact maintenance only, /logout withheld", async () => {
  const agy = await setup("compact");
  // Inject a server command list that includes logout, swarm, compact.
  agy.emit({
    method: "session/update",
    params: {
      sessionId: agy.run.sessionId(),
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "swarm", description: "Run swarm" },
          { name: "compact", description: "Compact conversation" },
          { name: "logout", description: "Log out" },
        ],
      },
    },
  });
  await flush();

  // logout must be stripped from commands list.
  assert.equal(
    agy.state.session?.commands.some((c) => c.name === "logout"),
    false,
  );
  // Typing /logout directly must be blocked with warning and never sent to agy.
  await agy.input(send("msg_logout", "/logout"));
  assert.equal(
    agy.written.filter((b) => b.method === "session/prompt").length,
    0,
  );
  assert.equal(
    agy.state.items.some(
      (i) =>
        i.kind === "notice" &&
        i.notice.type === "info" &&
        i.notice.level === "warning" &&
        i.notice.text.includes("/logout"),
    ),
    true,
  );

  // /swarm sent via composer -> MUST appear as normal user message & sent verbatim!
  await agy.input(send("msg_swarm", "/swarm build feature X"));
  const prompts = agy.written.filter((b) => b.method === "session/prompt");
  assert.equal(prompts.length, 1);
  assert.deepEqual((prompts[0]?.params as Frame).prompt, [
    { type: "text", text: "/swarm build feature X" },
  ]);
  assert.equal(
    userMessages(agy.state).some(
      (m) =>
        m.id === "msg_swarm" &&
        m.content[0]?.type === "text" &&
        m.content[0].text === "/swarm build feature X",
    ),
    true,
  );

  // During active turn, /plan (even with delivery: "steer") and /compact are queue-forced!
  await agy.input(send("msg_plan", "/plan step by step", "steer"));
  await agy.input(send("msg_compact", "/compact", "steer"));
  assert.equal(
    agy.written.filter((b) => b.method === "session/prompt").length,
    1,
  );
  assert.deepEqual(
    agy.state.queued.map((q) => q.id),
    ["msg_plan", "msg_compact"],
  );

  // Finish turn 1 (/swarm) -> drains /plan into turn 2 (recorded as user message).
  agy.emit({ id: prompts[0]?.id, result: { stopReason: "end_turn" } });
  await flush();
  await flush();
  const prompt2 = agy.written.filter((b) => b.method === "session/prompt")[1];
  assert.deepEqual((prompt2?.params as Frame).prompt, [
    { type: "text", text: "/plan step by step" },
  ]);
  assert.equal(
    userMessages(agy.state).some((m) => m.id === "msg_plan"),
    true,
  );

  // Finish turn 2 (/plan) -> drains /compact as maintenance (NO user message bubble, emits command_output!).
  agy.emit({ id: prompt2?.id, result: { stopReason: "end_turn" } });
  await flush();
  await flush();
  const prompt3 = agy.written.filter((b) => b.method === "session/prompt")[2];
  assert.deepEqual((prompt3?.params as Frame).prompt, [
    { type: "text", text: "/compact" },
  ]);
  // While /compact is running, steer must NOT bypass the queue.
  await agy.input(send("msg_after_compact", "follow up", "steer"));
  assert.equal(agy.state.queued[0]?.id, "msg_after_compact");

  // Complete /compact -> emits command_output notice, and /compact is NOT a user message!
  agy.emit({ id: prompt3?.id, result: { stopReason: "end_turn" } });
  await flush();
  assert.equal(
    userMessages(agy.state).some((m) => m.id === "msg_compact"),
    false,
  );
  assert.equal(
    agy.state.items.some(
      (i) =>
        i.kind === "notice" &&
        i.notice.type === "command_output" &&
        i.notice.command === "compact",
    ),
    true,
  );
});

// --- Subagent dock cards + reactive wakeups + daemon/cron exclusion + security warning ---

test("subagent/swarm cards stay running after end_turn, update in place, settle on usage_update, and exclude daemon/cron", async () => {
  const agy = await setup("text", {
    io: {
      reactiveTimers: {
        usageSettleMs: 25,
        quietMs: 200,
        runningToolsQuietMs: 500,
        maxHoldMs: 1000,
      },
    },
  });
  const sid = agy.run.sessionId();
  await agy.input(send("msg_1", "/swarm spawn worker"));
  const p1 = agy.written.find((b) => b.method === "session/prompt")?.id;

  // Emit a swarm(add) tool_call and an IsDaemon run_command.
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_swarm_1",
        name: "swarm",
        kind: "other",
        status: "in_progress",
        rawInput: {
          action: "add",
          name: "worker-alpha",
          brief: "Inspect module A",
        },
      },
    },
  });
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_daemon_1",
        name: "run_command",
        kind: "execute",
        status: "in_progress",
        rawInput: { CommandLine: "npm run dev", IsDaemon: true },
      },
    },
  });
  await flush();

  const subTool = tools(agy.state).find((t) => t.tool === "swarm");
  assert.equal(subTool?.detail.kind, "subagent");
  if (subTool?.detail.kind === "subagent") {
    assert.equal(subTool.detail.agent, "worker-alpha");
    assert.equal(subTool.detail.state, "running");
  }
  assert.equal(agy.state.tasks.length, 1);
  assert.equal(agy.state.tasks[0]?.state, "running");
  assert.equal(agy.run.running().tasks, 1);

  // Normal end_turn arrives while subagent is still running: MUST NOT cancel subagent!
  agy.emit({ id: p1, result: { stopReason: "end_turn" } });
  await flush();
  const stillSub = tools(agy.state).find((t) => t.tool === "swarm");
  assert.equal(stillSub?.state, "running");
  assert.equal(
    stillSub?.detail.kind === "subagent" ? stillSub.detail.state : null,
    "running",
  );
  assert.equal(agy.state.tasks[0]?.state, "running");

  // Late tool_call_update completes the subagent in place + unprompted follow-up text + usage_update settles turn!
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_swarm_1",
        name: "swarm",
        status: "completed",
        rawOutput: { output: "Worker alpha finished cleanly." },
      },
    },
  });
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "All workers done." },
      },
    },
  });
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "usage_update",
        used: 1200,
        size: 1048576,
      },
    },
  });
  await wait(60);

  const doneSub = tools(agy.state).find((t) => t.tool === "swarm");
  assert.equal(doneSub?.state, "ok");
  assert.equal(
    doneSub?.detail.kind === "subagent" ? doneSub.detail.state : null,
    "done",
  );
  assert.equal(agy.state.tasks[0]?.state, "done");
  assert.equal(agy.state.turn?.phase, "ended");
  assert.equal(
    agy.state.items.some(
      (i) =>
        i.kind === "message" &&
        i.actor === "agent" &&
        i.content[0]?.type === "text" &&
        i.content[0].text === "All workers done.",
    ),
    true,
  );
});

test("daemon commands and recurring cron schedules do NOT hold end_turn open", async () => {
  const agy = await setup("text");
  const sid = agy.run.sessionId();
  await agy.input(send("msg_1", "start daemon and cron"));
  const p1 = agy.written.find((b) => b.method === "session/prompt")?.id;

  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_d",
        name: "run_command",
        kind: "execute",
        status: "in_progress",
        rawInput: { CommandLine: "vite", IsDaemon: true },
      },
    },
  });
  agy.emit({
    method: "session/update",
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_cron",
        name: "schedule",
        kind: "other",
        status: "in_progress",
        rawInput: { CronExpression: "*/5 * * * *", Prompt: "ping" },
      },
    },
  });
  await flush();
  agy.emit({ id: p1, result: { stopReason: "end_turn" } });
  await flush();
  // Neither IsDaemon nor CronExpression should hold the turn open.
  assert.equal(agy.state.turn?.phase, "ended");
});

test("agy.security.warning in permission request emits a warning notice and interaction_* opens a question card", async () => {
  const agy = await setup("text");
  const sid = agy.run.sessionId();
  await agy.input(send("msg_1", "do risky thing"));

  agy.emit({
    id: "perm_warn",
    method: "session/request_permission",
    params: {
      sessionId: sid,
      toolCall: {
        toolCallId: "call_risky",
        name: "run_command",
        kind: "execute",
        rawInput: { CommandLine: "rm -rf /tmp/foo" },
      },
      options: [
        {
          optionId: "allow",
          name: "Allow",
          kind: "allow_once",
          _meta: { "agy.security.warning": "Destructive command detected." },
        },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    },
  });
  await flush();
  assert.equal(
    agy.state.items.some(
      (i) =>
        i.kind === "notice" &&
        i.notice.type === "info" &&
        i.notice.level === "warning" &&
        i.notice.text.includes("Destructive command detected."),
    ),
    true,
  );
  assert.equal(agy.state.pending.approval !== null, true);
  await agy.input({
    type: "decide",
    request: agy.state.pending.approval?.id,
    choice: { kind: "reject" },
  });

  // interaction_* permission opens a question card (not auto-approved).
  agy.emit({
    id: "perm_q",
    method: "session/request_permission",
    params: {
      sessionId: sid,
      toolCall: {
        toolCallId: "interaction_42",
        title: "Proceed with deployment?",
      },
      options: [
        { optionId: "yes", name: "Yes", kind: "allow_once" },
        { optionId: "no", name: "No", kind: "reject_once" },
      ],
    },
  });
  await flush();
  assert.equal(agy.state.pending.question !== null, true);
  assert.equal(agy.state.pending.approval, null);
});

// --- Read-only Brain Child Inspector + graceful degradation ---

test("read-only brain child inspector populates state.children and degrades gracefully on corrupt/missing/symlink files", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "lophn-agy-brain-"));
  try {
    const parentId = "d1fb45c2-7787-48fa-8857-7b99e57222f7";
    const childId = "child-worker-1111";
    const subagentsDir = join(
      fakeHome,
      ".gemini",
      "antigravity-cli",
      "brain",
      parentId,
      ".system_generated",
      "subagents",
    );
    const childLogsDir = join(
      fakeHome,
      ".gemini",
      "antigravity-cli",
      "brain",
      childId,
      ".system_generated",
      "logs",
    );
    mkdirSync(subagentsDir, { recursive: true });
    mkdirSync(childLogsDir, { recursive: true });

    writeFileSync(
      join(subagentsDir, `${childId}.json`),
      JSON.stringify({
        conversationId: childId,
        subagentDescriptor: {
          typeName: "worker",
          role: "Swarm Worker (worker-alpha)",
        },
        state: "SUBAGENT_STATE_ALIVE",
        spawnStepIndex: 10,
        workspaceUris: ["file:///work/text"],
      }),
    );
    // Corrupt JSON file must be silently skipped.
    writeFileSync(join(subagentsDir, "corrupt.json"), "{not valid json");
    // Symlink must NEVER be followed.
    const secretFile = join(fakeHome, "secret.json");
    writeFileSync(
      secretFile,
      JSON.stringify({
        conversationId: "symlinked-child",
        subagentDescriptor: { typeName: "worker", role: "Evil" },
        state: "SUBAGENT_STATE_ALIVE",
      }),
    );
    symlinkSync(secretFile, join(subagentsDir, "symlinked.json"));

    writeFileSync(
      join(childLogsDir, "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-25T04:00:00Z",
          content: "<USER_REQUEST>\nCheck the parser\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-25T04:00:05Z",
          thinking: "Looking at parser.ts",
          content: "Parser looks good.",
          tool_calls: [{ name: "read_file", args: { Path: "parser.ts" } }],
        }),
      ].join("\n"),
    );

    const agy = await setup("text", {
      home: fakeHome,
      io: { childPollIntervalMs: 50 },
    });
    assert.equal(agy.state.session?.capabilities.stop_child, false);
    assert.equal(agy.state.session?.capabilities.steer_child, false);

    await agy.input(send("msg_1", "/swarm start worker-alpha"));
    agy.emit({
      method: "session/update",
      params: {
        sessionId: parentId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_swarm_alpha",
          name: "swarm",
          kind: "other",
          status: "in_progress",
          rawInput: {
            action: "add",
            name: "worker-alpha",
            brief: "Check parser",
          },
        },
      },
    });
    await wait(90);

    // Child work linked to subagent card and transcript projected into state.children[childId]!
    const card = tools(agy.state).find((t) => t.tool === "swarm");
    assert.equal(card?.detail.kind, "subagent");
    if (card?.detail.kind === "subagent") {
      assert.equal(card.detail.child, childId);
      assert.equal(card.detail.last, "Parser looks good.");
    }
    const childState = agy.state.children[childId];
    assert.ok(childState !== undefined);
    // 밀리초 없는 transcript created_at도 acpStateSchema(atSchema)를 통과해야 acp/snapshot이 500으로 깨지지 않는다.
    assert.equal(childState.turn?.started_at, "2026-11-25T04:00:00.000Z");
    const parsedState = acpStateSchema.safeParse(withoutToolBodies(agy.state));
    assert.equal(
      parsedState.success,
      true,
      parsedState.success ? "" : JSON.stringify(parsedState.error.issues),
    );
    assert.equal(
      childState.items.some(
        (i) =>
          i.kind === "message" &&
          i.actor === "user" &&
          i.content[0]?.type === "text" &&
          i.content[0].text === "Check the parser",
      ),
      true,
    );
    assert.equal(
      childState.items.some(
        (i) =>
          i.kind === "message" &&
          i.actor === "agent" &&
          i.content[0]?.type === "text" &&
          i.content[0].text === "Parser looks good.",
      ),
      true,
    );
    // Symlinked child MUST NOT be read!
    assert.equal(agy.state.children["symlinked-child"], undefined);

    // Deleting brain files mid-run must NOT break the parent dock card.
    rmSync(subagentsDir, { recursive: true, force: true });
    await wait(70);
    const cardAfterDelete = tools(agy.state).find((t) => t.tool === "swarm");
    assert.equal(cardAfterDelete?.detail.kind, "subagent");
    await agy.run.stop();
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

// --- Existing TUI / flags / launch / catalog tests ---

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

  const carried = await setup("text", {
    carry: { args: ["--dangerously-skip-permissions"] },
  });
  assert.deepEqual(carried.spawned, [
    { command: "agy", args: ["acp", "--dangerously-skip-permissions"] },
  ]);

  const plain = await setup("text", {
    args: [],
    carry: { args: ["--dangerously-skip-permissions"] },
  });
  assert.deepEqual(plain.spawned, [{ command: "agy", args: ["acp"] }]);
  assert.equal(plain.run.tuiCommand(), `agy --conversation ${id}`);
  assert.deepEqual(plain.run.carry?.(), {});
});

const configCalls = (written: Frame[]) =>
  written
    .filter((body) => body.method === "session/set_config_option")
    .map((body) => {
      const params = body.params as Frame;
      return `${params.configId}=${params.value}`;
    });

test("launch model and effort are set after the session opens, with flags above carry above launch, and a loaded conversation is left alone", async () => {
  const launched = await setup("text", {
    launch: { model: "claude-sonnet-4-6", options: { effort: "low" } },
  });
  assert.deepEqual(configCalls(launched.written), [
    "model=claude-sonnet-4-6",
    "thought_level=low",
  ]);

  const flagged = await setup("text", {
    args: ["--model", "gpt-oss-120b-medium"],
    carry: { model: "claude-opus-4-6-thinking", effort: "medium" },
    launch: { model: "claude-sonnet-4-6", options: { effort: "low" } },
  });
  assert.deepEqual(configCalls(flagged.written), [
    "model=gpt-oss-120b-medium",
    "thought_level=medium",
  ]);

  const carried = await setup("text", {
    carry: { model: "claude-opus-4-6-thinking" },
    launch: { model: "claude-sonnet-4-6" },
  });
  assert.deepEqual(configCalls(carried.written), [
    "model=claude-opus-4-6-thinking",
  ]);

  const saved = "26e8bf45-50c5-4e72-b332-855cf6cff86e";
  const loaded = await setup("load", {
    resume: saved,
    saved: [saved],
    launch: { model: "claude-sonnet-4-6" },
  });
  assert.deepEqual(configCalls(loaded.written), []);
});

function catalogProc() {
  const created = recording("text").find(
    (entry) =>
      entry.kind === "recv" &&
      (entry.data.result as Frame | undefined)?.configOptions !== undefined,
  )?.data.result as Frame;
  const methods: string[] = [];
  const state = { ended: false, killed: false };
  let out: (text: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  const proc: CliProcess = {
    pid: 1,
    write(text) {
      const body = JSON.parse(text) as Frame;
      methods.push(body.method as string);
      const result = body.method === "session/new" ? created : {};
      setImmediate(() =>
        out(`${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n`),
      );
    },
    end: () => void (state.ended = true),
    kill() {
      state.killed = true;
      setImmediate(() => exit(null));
    },
    onStdout: (fn) => void (out = fn),
    onStderr() {},
    onExit: (fn) => void (exit = fn),
  };
  const spawned: { command: string; args: readonly string[] }[] = [];
  return {
    methods,
    state,
    spawned,
    spawn: (command: string, args: readonly string[]) => {
      spawned.push({ command, args });
      return proc;
    },
  };
}

test("fetchCatalog reads model and thought_level from session/new without sending a prompt, then closes agy", async () => {
  const fake = catalogProc();
  const adapter = createAntigravityAdapter({
    home: "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists: () => Promise.resolve(false),
  });
  assert.equal(adapter.catalogScope, "global");
  const result = await adapter.fetchCatalog({
    spawn: fake.spawn,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const group = result.value.models[0];
  assert.equal(group?.id, "antigravity");
  assert.deepEqual(
    group?.models.map((model) => model.id),
    [
      "gemini-3.8-flash",
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium",
    ],
  );
  const flash = group?.models[0]?.axes[0];
  assert.deepEqual(
    flash?.kind === "choice" ? flash.values.map((one) => one.value) : null,
    ["low", "medium", "high"],
  );
  assert.deepEqual(result.value.defaults, {
    model: "gemini-3.8-flash",
    options: { effort: "high" },
  });
  assert.deepEqual(fake.methods, [
    "initialize",
    "session/new",
    "session/close",
  ]);
  assert.deepEqual(fake.spawned, [{ command: "agy", args: ["acp"] }]);
  assert.equal(fake.state.ended, true);
  assert.equal(fake.state.killed, true);
});

test("fetchCatalog does not spawn agy when already aborted", async () => {
  const fake = catalogProc();
  const controller = new AbortController();
  controller.abort();
  const result = await createAntigravityAdapter({
    home: "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists: () => Promise.resolve(false),
  }).fetchCatalog({ spawn: fake.spawn, signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(fake.spawned.length, 0);
});

test("acpStateSchema accepts child transcripts with second-precision timestamps, empty model/diff fields, and float usage", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "lophn-agy-schema-"));
  const parentId = "d1fb45c2-7787-48fa-8857-7b99e57222f7";
  const childId = "child-schema-001";
  const subagentsDir = join(
    fakeHome,
    ".gemini",
    "antigravity-cli",
    "brain",
    parentId,
    ".system_generated",
    "subagents",
  );
  const childLogsDir = join(
    fakeHome,
    ".gemini",
    "antigravity-cli",
    "brain",
    childId,
    ".system_generated",
    "logs",
  );
  try {
    mkdirSync(subagentsDir, { recursive: true });
    mkdirSync(childLogsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, `${childId}.json`),
      JSON.stringify({
        conversationId: childId,
        subagentDescriptor: { typeName: "research", role: "Codebase Reader" },
        state: "SUBAGENT_STATE_ALIVE",
        spawnStepIndex: 1,
      }),
    );
    writeFileSync(
      join(childLogsDir, "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-25T15:57:30Z",
          content: "<USER_REQUEST>\nInspect snapshot\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "not-a-timestamp",
          content: "Done.",
        }),
      ].join("\n"),
    );

    const agy = await setup("text", {
      home: fakeHome,
      io: { childPollIntervalMs: 50 },
    });
    await agy.input(send("msg_1", "check"));
    agy.emit({
      method: "session/update",
      params: {
        sessionId: parentId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "model",
              currentValue: "",
              options: [{ value: "", name: "Empty" }],
            },
            {
              id: "mode",
              currentValue: "default",
              options: [{ value: "", name: "Blank" }],
            },
          ],
        },
      },
    });
    agy.emit({
      method: "session/update",
      params: {
        sessionId: parentId,
        update: {
          sessionUpdate: "usage_update",
          used: 123.7,
          size: -5,
        },
      },
    });
    agy.emit({
      method: "session/update",
      params: {
        sessionId: parentId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_edit_empty",
          name: "edit_file",
          kind: "edit",
          status: "completed",
          content: [{ type: "diff", path: "", newText: "a", oldText: "b" }],
        },
      },
    });
    agy.emit({
      method: "session/update",
      params: {
        sessionId: parentId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_sub_1",
          name: "invoke_subagent",
          kind: "other",
          status: "in_progress",
          rawInput: { Role: "Codebase Reader", Prompt: "Inspect snapshot" },
        },
      },
    });
    await wait(90);

    const childState = agy.state.children[childId];
    assert.ok(childState !== undefined);
    assert.equal(childState.turn?.started_at, "2026-11-25T15:57:30.000Z");
    assert.equal(agy.state.session?.model, null);
    assert.equal(agy.state.session?.usage?.context?.tokens, 123);
    assert.equal(agy.state.session?.usage?.context?.limit, 0);

    const parsed = acpStateSchema.safeParse(withoutToolBodies(agy.state));
    assert.equal(
      parsed.success,
      true,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    );
    await agy.run.stop();
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
