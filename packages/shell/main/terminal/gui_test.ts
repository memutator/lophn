import assert from "node:assert/strict";
import { test } from "node:test";

import { terminalHookLineSchema } from "../../../protocol/coding-agent/terminal-hook.ts";
import type { AcpTabRequest } from "../../../protocol/extensions/mod.ts";
import { type AcpState, EMPTY_ACP_STATE } from "../../../protocol/acp/mod.ts";
import { createHookIngress } from "./agent/ingress.ts";
import { cliEnv, createTabGui, type TabHandle } from "./gui.ts";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function setup(options: { state?: () => AcpState } = {}) {
  const requests: AcpTabRequest[] = [];
  const pushes: { channel: string; payload: unknown }[] = [];
  const gui = createTabGui({
    handlers: () =>
      Promise.resolve({
        gui(request) {
          requests.push(request);
          // extension은 탭에 묶인 handle을 열어 shell main에 알린다.
          gui.opened(fakeHandle(request.terminal.id, options.state));
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
    readImage: () => Promise.resolve(null),
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
  return { requests, opened, line, settle, gui };
}

function fakeHandle(
  terminal: string,
  state: () => AcpState = () => EMPTY_ACP_STATE,
): TabHandle {
  return {
    id: `win_${terminal}`,
    terminal,
    harness: "claude",
    handoff: "restart",
    cwd: "/work",
    state,
    attach: () => () => {},
    input: () => {},
    close: () => {},
  };
}

// 앱이 GUI가 띄운 CLI(shell main의 자식이라 shell_pid로 못 찾는다)를 session에 잇는 길이다. 이 표지가 빠지거나 shell main이
// 물려받은 값이 새면 앱이 엉뚱한 session에 process를 붙인다.
test("GUI가 띄우는 CLI는 그 탭의 session 표지를 받고 shell main이 물려받은 표지는 받지 않는다", async () => {
  const t = setup();
  t.line(KEY_A, { cwd: "/work/a" });
  await t.settle();
  const given = t.requests[0]?.terminal.env;
  assert.equal(given?.LOPHN_SESSION_ID, "term:trm_a");
  const env = cliEnv({
    base: { PATH: "/usr/bin", LOPHN_SESSION_ID: "ses_from_shell_main" },
    dataRoot: "/data",
    given,
  });
  assert.equal(env.LOPHN_SESSION_ID, "term:trm_a");
  assert.equal(
    cliEnv({ base: { LOPHN_SESSION_ID: "ses_x" }, dataRoot: "/data" })
      .LOPHN_SESSION_ID,
    undefined,
  );
});

// GUI view에는 foreground TUI도 없고 hook이 안 닿을 수 있어 tracker가 이 탭을 모른다. 목록은 handle의 ACP 상태로 채운다.
test("GUI 탭의 session은 ACP 상태의 제목, CLI session, turn 단계로 읽는다", async () => {
  let state = EMPTY_ACP_STATE;
  const t = setup({ state: () => state });
  t.line(KEY_A, { cwd: "/work/a" });
  await t.settle();
  assert.deepEqual(t.gui.tabSessions()[0]?.state, "unknown");
  state = {
    ...EMPTY_ACP_STATE,
    // test는 title과 cli_session만 읽는다.
    session: {
      title: "Fix the build",
      cli_session: "abc-1",
    } as unknown as AcpState["session"],
    turn: { id: "trn_1", phase: "working", started_at: null, elapsed: null },
  };
  assert.deepEqual(t.gui.tabSessions(), [
    {
      terminal_ref: "trm_a",
      harness: "claude",
      view: "gui",
      title: "Fix the build",
      cli_session: "abc-1",
      state: "running",
    },
  ]);
  state = { ...state, turn: { ...state.turn!, phase: "waiting" } };
  assert.equal(t.gui.tabSessions()[0]?.state, "waiting");
});

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
