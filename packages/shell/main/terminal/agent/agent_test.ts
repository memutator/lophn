import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalRuntime } from "../../../ipc/terminal.ts";
import { createHookIngress } from "./ingress.ts";
import { type AgentSignal, createAgentTracker } from "./tracker.ts";

const KEY = "a".repeat(64);

test("hook ingress drops unknown key, oversized and malformed lines and routes a valid one", () => {
  const routed: unknown[] = [];
  const ingress = createHookIngress({
    socket: "/run/h.sock",
    envName: "LPN_TERMINAL_HOOK",
    maxBytes: 200,
    newKey: () => KEY,
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
    looking: () => true,
    notify: () => false,
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
    looking: () => true,
    notify: () => false,
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
  const notices: string[] = [];
  const runtime = { terminal_ref: "t", state: "running" } as TerminalRuntime;
  const tracker = createAgentTracker({
    harnessOfProcess: () => null,
    interruptKeys: () => [],
    signalOf: (_harness, _event, payload) => payload as AgentSignal,
    runtimeOf: () => runtime,
    publish: (rt) => states.push(rt.agent?.state ?? "none"),
    looking: () => false,
    notify: (notice) => {
      notices.push(`${notice.kind}:${notice.body ?? ""}`);
      return true;
    },
    ...clock,
  });
  const send = (signal: AgentSignal) =>
    tracker.hook("t", "claude", "e", signal);
  return { tracker, clock, states, notices, send };
}

test("Stop while a subagent runs stays running without a finished notice, and the last child ending notifies once", () => {
  const { clock, states, notices, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "ChildStarted", child: "a1" });
  send({ type: "ChildStarted", child: "a2" });
  send({ type: "TurnEnded", message: "done", children: ["a1", "a2"] });
  clock.advance(5000);
  assert.equal(states.at(-1), "running");
  assert.deepEqual(notices, []);
  send({ type: "ChildEnded", child: "a1" });
  clock.advance(5000);
  assert.deepEqual(notices, []);
  send({ type: "ChildEnded", child: "a2" });
  assert.equal(states.at(-1), "idle"); // 상태는 바로 내려가고 알림만 늦다
  assert.deepEqual(notices, []);
  clock.advance(1500);
  clock.advance(60_000);
  assert.deepEqual(notices, ["finished:done"]);
});

test("a TurnStarted within 1.5s of Stop cancels the finished notice", () => {
  const { clock, notices, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "TurnEnded", message: "first" });
  clock.advance(1000);
  send({ type: "TurnStarted" });
  clock.advance(5000);
  assert.deepEqual(notices, []);
  send({ type: "TurnEnded", message: "second" });
  clock.advance(1500);
  assert.deepEqual(notices, ["finished:second"]);
});

test("a child tool hook resolves the permission wait, and a child with no signal for 10 minutes is dropped", () => {
  const { clock, states, notices, send } = childTracker();
  send({ type: "TurnStarted" });
  send({ type: "ChildStarted", child: "a1" });
  send({ type: "PermissionRequested" });
  assert.equal(states.at(-1), "waiting");
  send({ type: "ChildStarted", child: "a1" }); // 허락한 뒤 subagent의 tool hook
  assert.equal(states.at(-1), "running");
  send({ type: "TurnEnded", message: "done" });
  clock.advance(9 * 60_000);
  assert.equal(states.at(-1), "running");
  assert.deepEqual(notices, ["permission:"]);
  clock.advance(60_000);
  assert.equal(states.at(-1), "idle");
  clock.advance(1500);
  assert.deepEqual(notices, ["permission:", "finished:done"]);
});
