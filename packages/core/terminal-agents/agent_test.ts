import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { hookSignalOf } from "../../protocol/coding-agent/hook-signal.ts";
import type { TerminalRuntime } from "../../protocol/coding-agent/terminals.ts";
import {
  isAntigravitySubagent,
  readAntigravitySubagentIds,
  readAntigravityTitle,
} from "./antigravity-title.ts";
import { createHookIngress } from "./ingress.ts";
import { createTitleScanner } from "./osc-title.ts";
import { type AgentSignal, createAgentTracker } from "./tracker.ts";

const KEY = "a".repeat(64);

test("hook ingress drops unknown key, oversized and malformed lines and routes a valid one", () => {
  const routed: unknown[] = [];
  const ingress = createHookIngress({
    socket: "/run/h.sock",
    envName: "LPN_TERMINAL_HOOK",
    maxBytes: 200,
    newKey: () => KEY,
    guiEvent: "lophn-gui",
    onGui: () => {},
    parse: (value) => {
      const line = value as { v?: number; key?: string; event?: string };
      return line.v === 1 && typeof line.key === "string"
        ? {
            key: line.key,
            harness: "claude",
            event: line.event ?? "",
            payload: {},
          }
        : null;
    },
    onHook: (hook) => routed.push(hook),
  });
  const issued = ingress.issue()!;
  assert.deepEqual(JSON.parse(issued.env.LPN_TERMINAL_HOOK!), {
    socket: "/run/h.sock",
    key: KEY,
  });
  const line = (key: string, extra = "") =>
    JSON.stringify({ v: 1, key, event: "Stop" + extra });

  ingress.handleLine(line(KEY)); // issue만 하고 bind하지 않은 key
  ingress.bind(KEY, "term_1");
  ingress.handleLine(line("b".repeat(64))); // 모르는 key
  ingress.handleLine("{not json");
  ingress.handleLine(JSON.stringify({ v: 2, key: KEY }));
  ingress.handleLine(line(KEY, "x".repeat(300))); // maxBytes 초과
  assert.deepEqual(routed, []);

  ingress.handleLine(line(KEY));
  assert.deepEqual(routed, [
    {
      terminal_ref: "term_1",
      harness: "claude",
      event: "Stop",
      payload: {},
    },
  ]);

  ingress.revoke("term_1");
  ingress.handleLine(line(KEY));
  assert.equal(routed.length, 1);
});

// 시각과 timer를 손으로 돌리는 fake. tracker는 setTimeout을 직접 부르지 않는다.
function fakeClock() {
  let time = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => time,
    after(ms: number, fn: () => void) {
      const timer = { at: time + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const next = timers
          .filter((timer) => timer.live && timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        next.live = false;
        time = next.at;
        next.fn();
      }
      time = end;
    },
  };
}

function trackerFor(pushed: string[]) {
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  return createAgentTracker({
    harnessOfProcess: (argv) =>
      argv[0] === "claude" || argv[0] === "grok" ? argv[0] : null,
    interruptKeys: (harness) =>
      harness === "grok" ? ["ctrl-c"] : ["escape", "ctrl-c"],
    signalOf: (_harness, event) =>
      event === "Start"
        ? { type: "TurnStarted" }
        : event === "Ask"
          ? { type: "PermissionRequested" }
          : event === "Answer"
            ? { type: "PermissionResolved" }
            : { type: "TurnEnded" },
    runtimeOf: () => runtime,
    publish: (rt) =>
      pushed.push(`${rt.agent?.harness ?? "-"}:${rt.agent?.state ?? "none"}`),
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    ...fakeClock(),
  });
}

test("Esc or Ctrl-C while running makes the state unknown until the next hook", () => {
  const pushed: string[] = [];
  const tracker = trackerFor(pushed);
  tracker.foreground("t", ["claude"]);
  tracker.hook("t", "claude", "Start", {});
  tracker.humanInput("t", "a"); // 다른 글은 끊지 않는다
  tracker.humanInput("t", "\x1b");
  tracker.hook("t", "claude", "Stop", {});
  tracker.foreground("t", null);
  assert.deepEqual(pushed, [
    "claude:unknown",
    "claude:running",
    "claude:unknown",
    "claude:idle",
    "-:none",
  ]);
});

// 탭 이름이 날아가던 bug: 제목을 창의 xterm만 알아, 탭을 그리지 않았거나 다시 뜬 창은 자동 이름으로 떨어졌다.
test("the terminal's OSC title is read from PTY output across chunk splits and rides on the agent for every window", () => {
  const scan = createTitleScanner();
  assert.equal(scan("plain output"), null);
  assert.equal(scan("\x1b]0;\u2733 Claude Code\x07"), "\u2733 Claude Code");
  assert.equal(scan("text\x1b]2;Fix the"), null);
  assert.equal(scan(" widget\x1b\\more"), "Fix the widget");
  assert.equal(scan("\x1b]0;a\x07\x1b]0;b\x07\x1b"), "b");
  assert.equal(scan("]0;c\x07"), "c");
  // 제목이 아닌 OSC(8: link)는 읽지 않는다.
  assert.equal(scan("\x1b]8;;http://x\x07"), null);

  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  const titles: (string | undefined)[] = [];
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "claude" ? "claude" : null),
    interruptKeys: () => [],
    signalOf: () => null,
    runtimeOf: () => runtime,
    publish: (rt) => titles.push(rt.agent?.screen_title),
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    ...fakeClock(),
  });
  // agent가 뜨기 전의 제목도 터미널의 것이라 기억한다(TUI는 foreground로 알아보기 전에 첫 제목을 낸다).
  tracker.screenTitle("t", "\u2733 Claude Code");
  tracker.foreground("t", ["claude"]);
  tracker.screenTitle("t", "\u2802 Fix the widget");
  // spinner 프레임만 바뀌면 다시 알리지 않는다.
  tracker.screenTitle("t", "\u2810 Fix the widget");
  tracker.screenTitle("t", "\u2733 Fix the widget");
  assert.deepEqual(titles, ["Claude Code", "Fix the widget"]);
  assert.equal(tracker.decorate(runtime).agent?.screen_title, "Fix the widget");
});

test("a hook from another harness does not flip a tab the process identified, and Esc does not interrupt grok", () => {
  const pushed: string[] = [];
  const tracker = trackerFor(pushed);
  tracker.foreground("t", ["grok"]);
  // grok은 ~/.claude/settings.json의 hook도 읽어 claude hook을 보낸다.
  tracker.hook("t", "claude", "Start", {});
  tracker.hook("t", "grok", "Start", {});
  tracker.humanInput("t", "\x1b");
  tracker.hook("t", "grok", "Ask", {});
  tracker.hook("t", "grok", "Ask", {});
  tracker.hook("t", "grok", "Answer", {}); // 한 물음을 event 둘로 알려도 waiting이 풀린다
  tracker.humanInput("t", "\x03");
  assert.deepEqual(pushed, [
    "grok:unknown",
    "grok:running",
    "grok:waiting",
    "grok:running",
    "grok:unknown",
  ]);

  // process가 모르는 foreground(예: macOS의 node)에서는 hook이 알려 준 harness를 따른다.
  const adopted: string[] = [];
  const unknown = trackerFor(adopted);
  unknown.foreground("t", ["node"]);
  unknown.hook("t", "claude", "Start", {});
  assert.deepEqual(adopted, ["claude:running"]);
});

test("TurnStarted가 다른 session id를 싣고 오면 session을 바꾸고 제목을 새 prompt로 다시 받는다", () => {
  const seen: { session: string | null; title: string | null }[] = [];
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  const tracker = createAgentTracker({
    harnessOfProcess: () => null,
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (_harness, _event, payload) => {
      const { session, prompt } = payload as {
        session: string;
        prompt: string;
      };
      return { type: "TurnStarted", external_session: session, prompt };
    },
    runtimeOf: () => runtime,
    publish: (rt) =>
      seen.push({
        session: rt.agent?.session ?? null,
        title: rt.agent?.title ?? null,
      }),
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    ...fakeClock(),
  });
  tracker.hook("t", "claude", "UserPromptSubmit", {
    session: "a",
    prompt: "one",
  });
  tracker.hook("t", "claude", "UserPromptSubmit", {
    session: "b",
    prompt: "two",
  });
  assert.deepEqual(seen.at(-1), { session: "b", title: "two" });
});

test("키로 내린 뒤 tool이 끝났다는 hook이 오면 running으로 돌아오고, turn이 끝난 뒤의 늦은 hook은 되살리지 않는다", () => {
  const pushed: string[] = [];
  const tracker = trackerFor(pushed);
  tracker.foreground("t", ["claude"]);
  tracker.hook("t", "claude", "Start", {});
  tracker.humanInput("t", "\x03"); // 입력을 지우려던 Ctrl-C. turn은 안 끊겼다.
  tracker.hook("t", "claude", "Answer", {}); // tool이 끝났다.
  tracker.humanInput("t", "\x1b"); // 이번에는 진짜 끊었다.
  tracker.hook("t", "claude", "Stop", {});
  tracker.hook("t", "claude", "Answer", {}); // 끝난 turn 뒤의 늦은 hook
  assert.deepEqual(pushed, [
    "claude:unknown",
    "claude:running",
    "claude:unknown",
    "claude:running",
    "claude:unknown",
    "claude:idle",
  ]);
});

// fixture는 문서와 Claude Code CLI 2.1.316 bundle을 읽어 만들었다. 실제 harness로 돌려 확인하지 않았다.
function childTracker() {
  const clock = fakeClock();
  const states: string[] = [];
  const signals: string[] = [];
  const dismissed: string[] = [];
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  const tracker = createAgentTracker({
    harnessOfProcess: () => null,
    interruptKeys: () => [],
    signalOf: (_harness, _event, payload) => payload as AgentSignal,
    runtimeOf: () => runtime,
    publish: (rt) => states.push(rt.agent?.state ?? "none"),
    notify: () => {},
    signal: (info) => signals.push(info.kind),
    dismiss: (ref) => dismissed.push(ref),
    ...clock,
  });
  const send = (signal: AgentSignal) =>
    tracker.hook("t", "claude", "e", signal);
  return { tracker, clock, states, signals, dismissed, send };
}

test("Stop while a subagent runs stays running without a finished notice, and the last child ending notifies once", () => {
  const { clock, states, signals, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "ChildStarted", child: "a1" });
  send({ type: "ChildStarted", child: "a2" });
  send({ type: "TurnEnded", message: "done", children: ["a1", "a2"] });
  clock.advance(5000);
  assert.equal(states.at(-1), "running");
  assert.deepEqual(signals, []);
  send({ type: "ChildEnded", child: "a1" });
  clock.advance(5000);
  assert.deepEqual(signals, []);
  send({ type: "ChildEnded", child: "a2" });
  assert.equal(states.at(-1), "idle"); // 상태는 바로 내려가고 알림만 늦다
  assert.deepEqual(signals, []);
  clock.advance(1500);
  clock.advance(60_000);
  assert.deepEqual(signals, ["finished"]);

  // Stop의 목록은 snapshot이다. 먼저 끝난 child를 늦게 온 Stop이 다시 싣고 와도 다음 Stop이 지운다.
  send({ type: "TurnStarted" });
  send({ type: "ChildStarted", child: "a3" });
  send({ type: "ChildEnded", child: "a3" });
  send({ type: "TurnEnded", message: "again", children: ["a3"] });
  clock.advance(5000);
  assert.equal(states.at(-1), "running");
  send({ type: "TurnEnded", message: "last", children: [] });
  assert.equal(states.at(-1), "idle");
  clock.advance(1500);
  assert.deepEqual(signals, ["finished", "finished"]);
});

test("a TurnStarted within 1.5s of Stop cancels the finished notice", () => {
  const { clock, signals, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "TurnEnded", message: "first" });
  clock.advance(1000);
  send({ type: "TurnStarted" });
  clock.advance(5000);
  assert.deepEqual(signals, []);
  send({ type: "TurnEnded", message: "second" });
  clock.advance(1500);
  assert.deepEqual(signals, ["finished"]);
});

test("a child tool hook resolves the permission wait, and a child with no signal for 10 minutes is dropped", () => {
  const { clock, states, signals, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "ChildStarted", child: "a1" });
  send({ type: "PermissionRequested" });
  assert.equal(states.at(-1), "waiting");
  send({ type: "ChildStarted", child: "a1" }); // 허락한 뒤 subagent의 tool hook
  assert.equal(states.at(-1), "running");
  send({ type: "TurnEnded", message: "done" });
  clock.advance(9 * 60_000);
  assert.equal(states.at(-1), "running");
  assert.deepEqual(signals, ["waiting"]);
  clock.advance(60_000);
  assert.equal(states.at(-1), "idle");
  clock.advance(1500);
  assert.deepEqual(signals, ["waiting", "finished"]);
});

test("a new turn after a finished signal dismisses the terminal's unseen mark, a turn continued inside the finish delay does not", () => {
  const { clock, signals, dismissed, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "TurnEnded", message: "first" });
  clock.advance(1000);
  send({ type: "TurnStarted" }); // child 사이의 틈: 같은 turn
  assert.deepEqual(dismissed, ["t"]);
  send({ type: "TurnEnded", message: "first" });
  clock.advance(1500);
  assert.deepEqual(signals, ["finished"]);
  send({ type: "TurnStarted" });
  assert.deepEqual(dismissed, ["t", "t"]);
});

test("tracker seeds resumed session and launch args from foreground argv, falls back to expectResume, and hydrates saved names", async () => {
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  let latest: TerminalRuntime = runtime;
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "agy" ? "antigravity" : null),
    sessionOfProcess: (_harness, argv) => {
      const idx = argv.indexOf("--conversation");
      return idx >= 0 ? (argv[idx + 1] ?? null) : null;
    },
    launchArgsOfProcess: (_harness, argv) =>
      argv.slice(1).filter((a) => a !== "--conversation" && a !== "conv-1"),
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: () => null,
    runtimeOf: () => runtime,
    publish: (rt) => {
      latest = rt;
    },
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    lookupSession: async ({ session }) =>
      session === "conv-1"
        ? { title: "First prompt", name: "Pinned name", pinned: true }
        : null,
    ...fakeClock(),
  });

  tracker.foreground("t", [
    "agy",
    "--dangerously-skip-permissions",
    "--conversation",
    "conv-1",
  ]);
  assert.deepEqual(tracker.tuiOf("t"), {
    harness: "antigravity",
    state: "unknown",
    session: "conv-1",
    cwd: null,
    args: ["--dangerously-skip-permissions"],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latest.agent?.session, "conv-1");
  assert.equal(latest.agent?.title, "First prompt");
  assert.equal(latest.agent?.name, "Pinned name");

  // 비 Linux처럼 argv에 인자가 없어도 expectResume으로 1회 seed된다.
  tracker.foreground("t", null);
  tracker.expectResume("t", "antigravity", "conv-1");
  tracker.foreground("t", ["agy"]);
  assert.deepEqual(tracker.tuiOf("t"), {
    harness: "antigravity",
    state: "unknown",
    session: "conv-1",
    cwd: null,
    args: [],
  });
  // 한 번 쓴 뒤 다시 새 TUI를 띄우면 이전 expectResume을 재사용하지 않는다.
  tracker.foreground("t", null);
  tracker.foreground("t", ["agy"]);
  assert.equal(tracker.tuiOf("t")?.session, null);
});

test("shell prompt OSC title does not bleed into an agent that sets no OSC title, and TurnEnded hydrates external AI title", async () => {
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  let latest: TerminalRuntime = runtime;
  const savedSeen: {
    session: string;
    title: string | null;
    name: string | null;
  }[] = [];
  let aiTitle: string | null = null;
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "agy" ? "antigravity" : null),
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (_harness, event, payload) => {
      const p = payload as { conversationId?: string; prompt?: string };
      if (event === "SessionStart") {
        return { type: "SessionStarted", external_session: p.conversationId };
      }
      if (event === "PreInvocation") {
        return {
          type: "TurnStarted",
          external_session: p.conversationId,
          prompt: p.prompt,
        };
      }
      return { type: "TurnEnded", external_session: p.conversationId };
    },
    runtimeOf: () => runtime,
    publish: (rt) => {
      latest = rt;
    },
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    sessionSeen: (info) =>
      savedSeen.push({
        session: info.session,
        title: info.title,
        name: info.name,
      }),
    lookupSession: async () =>
      aiTitle === null
        ? null
        : { title: null, name: aiTitle, pinned: false, persist: true },
    ...fakeClock(),
  });

  // bash prompt가 설정한 OSC 제목은 상태 글리프가 없어 agent의 screen_title로 넘기지 않는다.
  tracker.screenTitle("t", "user@host: ~/projects/lophn");
  tracker.foreground("t", ["agy"]);
  assert.equal(latest.agent?.screen_title, undefined);

  tracker.hook("t", "antigravity", "SessionStart", {
    conversationId: "conv-1",
  });
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "conv-1",
    prompt: "fix the session title",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latest.agent?.title, "fix the session title");
  assert.equal(latest.agent?.name, undefined);

  // turn이 끝날 때 agy summary DB에 생성된 AI 제목이 hydrate되어 name과 저장소에 반영된다.
  aiTitle = "Fix Session Title";
  tracker.hook("t", "antigravity", "Stop", { conversationId: "conv-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latest.agent?.name, "Fix Session Title");
  assert.deepEqual(savedSeen.at(-1), {
    session: "conv-1",
    title: "fix the session title",
    name: "Fix Session Title",
  });
});

test("readAntigravityTitle reads non-empty titles from conversation_summaries.db read-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-agy-title-"));
  try {
    const dbPath = join(dir, "conversation_summaries.db");
    assert.equal(readAntigravityTitle(dbPath, "missing"), null);

    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT)",
    );
    db.prepare(
      "INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?)",
    ).run("conv-1", "Feedback On Lophn Coding Agents");
    db.prepare(
      "INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?)",
    ).run("conv-empty", "   ");
    db.close();

    assert.equal(
      readAntigravityTitle(dbPath, "conv-1"),
      "Feedback On Lophn Coding Agents",
    );
    assert.equal(readAntigravityTitle(dbPath, "conv-empty"), null);
    assert.equal(readAntigravityTitle(dbPath, "conv-missing"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("antigravity subagent filter ①②③ isolates child hooks from main session/title/Recent and ghost PostToolUse is ignored after idle Stop", () => {
  const clock = fakeClock();
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  let latest: TerminalRuntime = runtime;
  const seenSessions: Array<{
    session: string;
    title: string | null;
    name: string | null;
  }> = [];
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "agy" ? "antigravity" : null),
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (_harness, event, payload) => {
      const p = payload as Record<string, unknown>;
      const external_session =
        typeof p.conversationId === "string" ? p.conversationId : undefined;
      if (event === "SessionStart") {
        return { type: "SessionStarted", external_session };
      }
      if (event === "PreInvocation") {
        const prompt =
          typeof p.lastUserInput === "string" ? p.lastUserInput : undefined;
        return { type: "TurnStarted", external_session, prompt };
      }
      if (event === "PreToolUse") {
        return p.tool_name === "ask_question"
          ? { type: "PermissionRequested", external_session }
          : null;
      }
      if (event === "PostToolUse") {
        return { type: "PermissionResolved", external_session };
      }
      if (event === "Stop") {
        return p.fullyIdle === true
          ? { type: "TurnEnded", outcome: "completed", external_session }
          : null;
      }
      return null;
    },
    runtimeOf: () => runtime,
    publish: (rt) => {
      latest = rt;
    },
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    sessionSeen: (info) =>
      seenSessions.push({
        session: info.session,
        title: info.title,
        name: info.name,
      }),
    ...clock,
  });

  tracker.foreground("t", ["agy"]);
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "parent-1",
    lastUserInput: "launch a swarm",
  });
  assert.equal(latest.agent?.session, "parent-1");
  assert.equal(latest.agent?.title, "launch a swarm");
  assert.equal(latest.agent?.state, "running");

  // 규칙 ①: invoke_subagent / swarm PreToolUse는 subagentParent를 기록하고 waiting으로 올리지 않는다.
  tracker.hook("t", "antigravity", "PreToolUse", {
    conversationId: "parent-1",
    tool_name: "invoke_subagent",
  });
  assert.equal(latest.agent?.state, "running");

  // 부모가 일단 idle Stop을 보내도, subagent hook(규칙 ②)이 자식 활동을 유지하고 메인 세션·제목을 덮지 않으며 Recent에도 안 쌓인다.
  const seenBeforeSubagent = seenSessions.length;
  tracker.hook("t", "antigravity", "SessionStart", {
    conversationId: "child-1",
    lastUserInput: "",
  });
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "child-1",
  });
  // 중첩 subagent가 send_message를 불러도 subagentParent를 덮어쓰지 않는다.
  tracker.hook("t", "antigravity", "PreToolUse", {
    conversationId: "child-1",
    tool_name: "send_message",
  });
  assert.equal(latest.agent?.session, "parent-1");
  assert.equal(latest.agent?.title, "launch a swarm");
  assert.equal(latest.agent?.state, "running");
  assert.equal(seenSessions.length, seenBeforeSubagent);

  // 부모 idle Stop 뒤 child가 살아 있으면 계속 running이고, child가 idle Stop으로 끝나면 비로소 idle이다.
  tracker.hook("t", "antigravity", "Stop", {
    conversationId: "parent-1",
    fullyIdle: true,
  });
  assert.equal(latest.agent?.state, "running");

  tracker.hook("t", "antigravity", "Stop", {
    conversationId: "child-1",
    fullyIdle: true,
  });
  assert.equal(latest.agent?.state, "idle");
  assert.equal(
    seenSessions.some((s) => s.session === "child-1"),
    false,
  );

  // 유령 PostToolUse 차단: idle Stop 뒤 늦게 온 PostToolUse는 sessionSeen이나 상태를 건드리지 않는다.
  const seenBeforeGhost = seenSessions.length;
  tracker.hook("t", "antigravity", "PostToolUse", {
    conversationId: "parent-1",
    tool_name: "run_command",
  });
  assert.equal(latest.agent?.state, "idle");
  assert.equal(seenSessions.length, seenBeforeGhost);

  // 규칙 ③: lastUserInput이 있는 새 conversationId는 정상 세션 전환한다.
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "user-new-2",
    lastUserInput: "new user conversation",
  });
  assert.equal(latest.agent?.session, "user-new-2");
  assert.equal(latest.agent?.title, "new user conversation");
  assert.equal(latest.agent?.state, "running");
  assert.equal(seenSessions.at(-1)?.session, "user-new-2");
});

test("antigravity TurnEnded schedules a delayed summary DB re-read (~2000ms) and cancels it on gone()", async () => {
  const clock = fakeClock();
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  let latest: TerminalRuntime = runtime;
  let lookups = 0;
  let delayedTitle: string | null = null;
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "agy" ? "antigravity" : null),
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (_harness, event, payload) => {
      const p = payload as { conversationId?: string; prompt?: string };
      if (event === "PreInvocation") {
        return {
          type: "TurnStarted",
          external_session: p.conversationId,
          prompt: p.prompt,
        };
      }
      if (event === "Stop") {
        return {
          type: "TurnEnded",
          outcome: "completed",
          external_session: p.conversationId,
        };
      }
      return null;
    },
    runtimeOf: () => runtime,
    publish: (rt) => {
      latest = rt;
    },
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    lookupSession: async () => {
      lookups += 1;
      return delayedTitle === null
        ? null
        : { title: null, name: delayedTitle, pinned: false, persist: true };
    },
    ...clock,
  });

  tracker.foreground("t", ["agy"]);
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "conv-delay",
    prompt: "fix title",
  });
  tracker.hook("t", "antigravity", "Stop", { conversationId: "conv-delay" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latest.agent?.name, undefined);

  // 2초 뒤 summary DB에 제목이 쓰였으면 delayed re-read가 읽어 반영한다.
  delayedTitle = "Delayed Summary Title";
  clock.advance(2000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latest.agent?.name, "Delayed Summary Title");

  // 다음 Stop 뒤 gone()하면 예약된 타이머가 취소되어 추가 lookup을 하지 않는다.
  tracker.hook("t", "antigravity", "PreInvocation", {
    conversationId: "conv-delay",
    prompt: "next",
  });
  tracker.hook("t", "antigravity", "Stop", { conversationId: "conv-delay" });
  const lookupsBeforeGone = lookups;
  tracker.gone("t");
  clock.advance(5000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lookups, lookupsBeforeGone);
});

test("isAntigravitySubagent and readAntigravitySubagentIds detect parent_conversation_id / nesting_depth and fail open on old schemas", () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-agy-subagent-db-"));
  const dbPath = join(dir, "conversation_summaries.db");
  const legacyPath = join(dir, "legacy.db");
  try {
    assert.equal(isAntigravitySubagent(dbPath, "missing"), false);
    assert.deepEqual([...readAntigravitySubagentIds(dbPath, ["missing"])], []);

    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', parent_conversation_id TEXT NOT NULL DEFAULT '', nesting_depth INTEGER NOT NULL DEFAULT 0)",
    );
    const insert = db.prepare(
      "INSERT INTO conversation_summaries (conversation_id, title, parent_conversation_id, nesting_depth) VALUES (?, ?, ?, ?)",
    );
    insert.run("parent-main", "UI/UX and Bug Fixes", "", 0);
    insert.run("child-by-parent", "", "parent-main", 1);
    insert.run("child-by-depth", "", "", 2);
    db.close();

    assert.equal(isAntigravitySubagent(dbPath, "parent-main"), false);
    assert.equal(isAntigravitySubagent(dbPath, "child-by-parent"), true);
    assert.equal(isAntigravitySubagent(dbPath, "child-by-depth"), true);
    assert.equal(isAntigravitySubagent(dbPath, "unknown-id"), false);
    assert.deepEqual(
      [
        ...readAntigravitySubagentIds(dbPath, [
          "parent-main",
          "child-by-parent",
          "child-by-depth",
          "unknown-id",
        ]),
      ].sort(),
      ["child-by-depth", "child-by-parent"],
    );

    // 컬럼이 없는 옛 스키마에서는 예외 없이 false / 빈 집합을 돌려준다.
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(
      "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT)",
    );
    legacy
      .prepare(
        "INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?)",
      )
      .run("parent-main", "Legacy");
    legacy.close();
    assert.equal(isAntigravitySubagent(legacyPath, "parent-main"), false);
    assert.deepEqual(
      [...readAntigravitySubagentIds(legacyPath, ["parent-main"])],
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("antigravity real protojson toolCall.name, parentConversationId, and DB fallback block subagents from Recent and main session", () => {
  const clock = fakeClock();
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  let latest: TerminalRuntime = runtime;
  const seenSessions: string[] = [];
  const dbSubagents = new Set(["child-after-restart"]);
  const tracker = createAgentTracker({
    harnessOfProcess: (argv) => (argv[0] === "agy" ? "antigravity" : null),
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (harness, event, payload) =>
      hookSignalOf(harness as "antigravity", event, payload),
    runtimeOf: () => runtime,
    publish: (rt) => {
      latest = rt;
    },
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    isAntigravitySubagent: (id) => dbSubagents.has(id),
    sessionSeen: (info) => seenSessions.push(info.session),
    ...clock,
  });

  // 1) 재현: GUI/resume 등으로 entry.session이 아직 null인 상태에서 agy 실제 protojson(toolCall.name)으로 invoke_subagent가 먼저 온다.
  tracker.hook("t", "antigravity", "PreToolUse", {
    conversationId: "parent-1",
    toolCall: {
      id: "call_1",
      name: "invoke_subagent",
      args: { TypeName: "self", Role: "Fixer" },
    },
    stepIdx: 26,
    hookEventName: "PreToolUse",
  });
  // 부모 PostToolUse가 entry.session을 최초 획득해도 방금 기록한 subagentParent를 지우지 않는다.
  tracker.hook("t", "antigravity", "PostToolUse", {
    conversationId: "parent-1",
    toolCall: {
      id: "call_1",
      name: "invoke_subagent",
      args: { TypeName: "self", Role: "Fixer" },
    },
    stepIdx: 26,
    hookEventName: "PostToolUse",
  });
  assert.equal(latest.agent?.session, "parent-1");

  // parentConversationId가 없더라도 규칙 ①②(toolCall.name)가 child hook을 잡아 Recent(sessionSeen)로 흘리지 않는다.
  tracker.hook("t", "antigravity", "SessionStart", {
    conversationId: "child-via-toolcall",
    lastUserInput: "",
  });
  tracker.hook("t", "antigravity", "PostToolUse", {
    conversationId: "child-via-toolcall",
    toolCall: { id: "call_2", name: "run_command", args: {} },
  });
  assert.equal(latest.agent?.session, "parent-1");
  assert.equal(latest.agent?.state, "running");
  assert.equal(seenSessions.includes("child-via-toolcall"), false);

  tracker.hook("t", "antigravity", "Stop", {
    conversationId: "child-via-toolcall",
    fullyIdle: true,
  });

  // 2) 새 터미널(subagentParent === null, core 재시작 직후 상황): parentConversationId 직접 표지로 즉시 차단한다.
  const runtime2 = { terminal_ref: "t2", state: "running" } as TerminalRuntime;
  const tracker2 = createAgentTracker({
    harnessOfProcess: () => null,
    interruptKeys: () => ["escape", "ctrl-c"],
    signalOf: (harness, event, payload) =>
      hookSignalOf(harness as "antigravity", event, payload),
    runtimeOf: () => runtime2,
    publish: () => {},
    notify: () => {},
    signal: () => {},
    dismiss: () => {},
    isAntigravitySubagent: (id) => dbSubagents.has(id),
    sessionSeen: (info) => seenSessions.push(info.session),
    ...clock,
  });
  tracker2.hook("t2", "antigravity", "SessionStart", {
    conversationId: "child-direct-meta",
    parentConversationId: "parent-2",
    rootConversationId: "parent-2",
    lastUserInput: "",
  });
  tracker2.hook("t2", "antigravity", "PreInvocation", {
    conversationId: "child-direct-meta",
    parentConversationId: "parent-2",
    lastUserInput: "even if non-empty",
  });
  // 3) parentConversationId가 빠져도 summary DB 표지(isAntigravitySubagent)가 차단한다.
  tracker2.hook("t2", "antigravity", "PostToolUse", {
    conversationId: "child-after-restart",
    toolCall: { id: "call_3", name: "read_file", args: {} },
  });

  assert.equal(seenSessions.includes("child-direct-meta"), false);
  assert.equal(seenSessions.includes("child-after-restart"), false);
  assert.equal(tracker2.agentOf("t2"), undefined);
});
