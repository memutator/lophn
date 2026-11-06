import assert from "node:assert/strict";
import { test } from "node:test";

import { terminalHookLineSchema } from "../../../protocol/coding-agent/terminal-hook.ts";
import type { AcpTabRequest } from "../../../protocol/extensions/mod.ts";
import { createHookIngress } from "./agent/ingress.ts";
import { cliEnv, createTabGui, type TabHandle } from "./gui.ts";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function setup() {
  const requests: AcpTabRequest[] = [];
  const pushes: { channel: string; payload: unknown }[] = [];
  const gui = createTabGui({
    handlers: () =>
      Promise.resolve({
        gui(request) {
          requests.push(request);
          // extension은 탭에 묶인 handle을 열어 shell main에 알린다.
          gui.opened(fakeHandle(request.terminal.id));
        },
        tui: () => {},
        running: () => null,
        sessions: () => Promise.resolve([]),
        rewindPreview: () => Promise.resolve(null),
      }),
    showExtensionSettings: () => {},
    windows: () => [
      { send: (channel, payload) => void pushes.push({ channel, payload }) },
    ],
    ids: { request: () => "req_1" },
    after: () => () => {},
    terminals: {
      runtime: (ref) =>
        ref === "trm_a" || ref === "trm_b"
          ? { cwd: "/work", generation: 1 }
          : undefined,
      hookEnv: () => ({}),
      tui: () => null,
      type: () => Promise.resolve(),
      signal: () => Promise.resolve(),
      onForegroundExit: () => () => {},
    },
    writeImage: () => Promise.resolve("/tmp/x"),
    log: () => {},
  });
  const ingress = createHookIngress({
    socket: "/run/h.sock",
    envName: "LPN_TERMINAL_HOOK",
    maxBytes: 65_536,
    newKey: (() => {
      const keys = [KEY_A, KEY_B];
      return () => keys.shift()!;
    })(),
    guiEvent: "lophn-gui",
    parse(value) {
      const parsed = terminalHookLineSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    onHook: () => {},
    onGui: (hook) => void gui.request(hook),
  });
  ingress.bind(ingress.issue()!.key, "trm_a");
  ingress.bind(ingress.issue()!.key, "trm_b");
  const line = (key: string, payload: unknown) =>
    ingress.handleLine(
      JSON.stringify({
        v: 1,
        key,
        harness: "claude",
        event: "lophn-gui",
        payload,
      }),
    );
  const opened = () =>
    pushes
      .filter((push) => push.channel === "harness-gui:tab-opened")
      .map((push) => (push.payload as { terminal_ref: string }).terminal_ref);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { requests, opened, line, settle };
}

function fakeHandle(terminal: string): TabHandle {
  return {
    id: `win_${terminal}`,
    terminal,
    harness: "claude",
    handoff: "restart",
    cwd: "/work",
    attach: () => () => {},
    input: () => {},
    close: () => {},
  };
}

// 한 탭의 `claude gui`가 다른 탭의 GUI를 열거나, 모르는 key가 아무 탭이나 바꾸면 안 된다.
test("lophn-gui 요청은 그 key의 터미널에만 handle을 열고 모르는 key로는 열지 않는다", async () => {
  const t = setup();

  t.line(KEY_A, { cwd: "/work/a", resume: "abc-1" });
  await t.settle();
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0]?.terminal.id, "trm_a");
  assert.equal(t.requests[0]?.terminal.cwd, "/work/a");
  assert.equal(t.requests[0]?.resume, "abc-1");
  assert.deepEqual(t.opened(), ["trm_a"]);

  t.line("c".repeat(64), { cwd: "/work/c" }); // 모르는 key
  t.line(KEY_B, { cwd: "relative/dir" }); // 절대 경로가 아니다
  t.line(KEY_B, { cwd: "/work/b", resume: "../etc" }); // id에 쓸 수 없는 글자
  await t.settle();
  assert.equal(t.requests.length, 1);
  assert.deepEqual(t.opened(), ["trm_a"]);

  t.line(KEY_B, { cwd: "/work/b" });
  await t.settle();
  assert.deepEqual(
    t.requests.map((request) => request.terminal.id),
    ["trm_a", "trm_b"],
  );
  assert.deepEqual(t.opened(), ["trm_a", "trm_b"]);
});

// GUI가 띄우는 CLI가 lophn을 띄운 Claude Code session의 자식으로 보이면 시작하지 않거나 대화를 저장하지 않는다.
// 반대로 login shell에 둔 API key와 그 탭의 hook env까지 지우면 CLI가 로그인하지 못하고 탭 상태 점이 꺼진다.
test("CLI env에서 상위 session 표지는 빠지고 provider key와 탭의 hook env는 남는다", () => {
  const env = cliEnv({
    base: {
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CODEX_THREAD_ID: "t",
    },
    dataRoot: "/data",
    given: {
      ANTHROPIC_API_KEY: "sk-test",
      LPN_TERMINAL_HOOK: '{"socket":"/s","key":"k"}',
      CLAUDECODE: "1", // login shell이 물려받은 것
      CLAUDE_CODE_SESSION_ID: "s",
    },
  });
  assert.equal(env.ANTHROPIC_API_KEY, "sk-test");
  assert.equal(env.LPN_TERMINAL_HOOK, '{"socket":"/s","key":"k"}');
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.LOPHN_HOME, "/data");
  for (const marker of [
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_THREAD_ID",
  ]) {
    assert.equal(marker in env, false, marker);
  }
});
