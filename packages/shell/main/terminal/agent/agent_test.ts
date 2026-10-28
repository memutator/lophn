import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalRuntime } from "../../../ipc/terminal.ts";
import { createHookIngress } from "./ingress.ts";
import { createAgentTracker } from "./tracker.ts";

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
