import assert from "node:assert/strict";
import { test } from "node:test";

import { terminalHookLineSchema } from "../../../protocol/coding-agent/terminal-hook.ts";
import type { AcpTabRequest } from "../../../protocol/extensions/mod.ts";
import {
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
} from "../../../protocol/acp/mod.ts";
import { createHookIngress } from "./agent/ingress.ts";
import {
  cliEnv,
  createTabGui,
  type TabHandle,
  type ToggleSource,
} from "./gui.ts";

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
      handoff: "restart",
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

// 폰이 연 GUI는 볼 창이 없을 수 있다. 창의 ack를 기다리면 1.5초 뒤 handle이 닫혀 폰의 전환이 늘 실패한다. 반대로 TUI를 끄지 못했는데
// GUI가 시작된 것처럼 두면 한 CLI session에 process 둘이 뜰 수 있다(harness-gui 불변식 6).
test("폰이 시작한 GUI 전환은 ack 없이 GUI로 남고, TUI를 끄지 못하면 handle을 닫아 failed로 끝나며 TUI는 그대로다", async () => {
  const timers: (() => void)[] = [];
  const typed: string[] = [];
  let tuiAlive = true;
  let exitFails = false;
  let started = false;
  const handles: { handle: TabHandle; closed: () => boolean }[] = [];
  const gui = createTabGui({
    handlers: () =>
      Promise.resolve({
        // extension의 길: handle을 열고, foreground TUI를 끈 뒤에야 adapter를 시작한다. 실패는 handle의 실패한 turn이다.
        gui(request) {
          const opened = liveHandle(request.terminal.id, handles.length);
          handles.push(opened);
          gui.opened(opened.handle);
          if (exitFails) {
            opened.publish({
              type: "turn_ended",
              turn: `trn_01${"c".repeat(24)}`,
              at: "2026-11-15T00:00:00.000Z",
              outcome: "failed",
              active_ms: null,
              error: { code: "unavailable", message: "did not exit" },
              messages: [],
              seq: 1,
            });
            return;
          }
          tuiAlive = false;
          started = true;
        },
        tui: () => {},
        running: () => (started ? { turn: false, tasks: 0 } : null),
        sessions: () => Promise.resolve([]),
        rewindPreview: () => Promise.resolve(null),
      }),
    showExtensionSettings: () => {},
    windows: () => [],
    ids: { request: () => "req_1" },
    after: (_ms, run) => {
      timers.push(run);
      return () => {};
    },
    terminals: {
      runtime: () => ({ cwd: "/work", generation: 1 }),
      hookEnv: () => ({}),
      tui: () =>
        tuiAlive
          ? {
              harness: "claude",
              state: "running",
              session: "abc-1",
              cwd: "/work",
            }
          : null,
      type: (_ref, text) => {
        typed.push(text);
        return Promise.resolve();
      },
      signal: () => Promise.resolve(),
      onForegroundExit: () => () => {},
    },
    writeImage: () => Promise.resolve("/tmp/x"),
    readImage: () => Promise.resolve(null),
    log: () => {},
  });
  const fireTimers = () => {
    for (const run of timers.splice(0)) run();
  };
  const toggle = (source: ToggleSource) =>
    gui.toggle({ terminal_ref: "trm_a", to: "gui" }, source);

  // desktop은 그대로다: 탭을 가진 창이 ack하지 않으면 handle을 닫는다.
  assert.deepEqual(await toggle("desktop"), { ok: true });
  fireTimers();
  assert.equal(handles[0]?.closed(), true);

  tuiAlive = true;
  started = false;
  assert.deepEqual(await toggle("phone"), { ok: true });
  fireTimers();
  assert.equal(handles[1]?.closed(), false);
  assert.equal(gui.current("trm_a")?.view, "gui");
  handles[1]?.handle.close();

  tuiAlive = true;
  started = false;
  exitFails = true;
  assert.deepEqual(await toggle("phone"), {
    ok: false,
    reason: "failed",
    message: "did not exit",
  });
  assert.equal(handles[2]?.closed(), true);
  assert.equal(gui.current("trm_a"), null);
  assert.equal(tuiAlive, true);
  assert.deepEqual(typed, []);
});

function liveHandle(terminal: string, n: number) {
  let closed = false;
  const listeners = new Set<Parameters<TabHandle["attach"]>[0]>();
  const handle: TabHandle = {
    id: `win_${n}`,
    terminal,
    harness: "claude",
    handoff: "restart",
    cwd: "/work",
    state: () => EMPTY_ACP_STATE,
    attach(listener) {
      if (closed) {
        listener.closed();
        return () => {};
      }
      listener.snapshot(EMPTY_ACP_STATE);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    input: () => {},
    close() {
      if (closed) return;
      closed = true;
      for (const listener of [...listeners]) listener.closed();
    },
  };
  return {
    handle,
    closed: () => closed,
    publish(update: AcpUpdate) {
      for (const listener of listeners) listener.update(update);
    },
  };
}
