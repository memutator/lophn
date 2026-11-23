import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { manualClock } from "../../base/clock.ts";
import type { AcpTabRequest } from "../../protocol/acp/mod.ts";
import {
  type AcpState,
  type AcpToolItem,
  type AcpUpdate,
  EMPTY_ACP_STATE,
} from "../../protocol/acp/mod.ts";
import { terminalHookLineSchema } from "../../protocol/coding-agent/terminal-hook.ts";
import type { TerminalRuntime } from "../../protocol/coding-agent/terminals.ts";
import type { Terminals } from "../terminals/ports.ts";
import { createCodingSessions } from "./coding-sessions.ts";
import {
  attachBatched,
  createTabGui,
  type TabGuiDeps,
  type TabHandle,
} from "./gui.ts";
import { createHookIngress } from "./ingress.ts";
import { createTerminalAgents } from "./service.ts";
import { createAgentSessionStore } from "./session-store.ts";
import { cliEnv } from "./spawner.ts";

const NO_IMAGES: TabGuiDeps["images"] = {
  root: "/tmp/lophn-gui",
  write: () => Promise.resolve(),
  read: () => Promise.resolve(null),
};

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function setup(
  options: { state?: () => AcpState; images?: TabGuiDeps["images"] } = {},
) {
  const requests: AcpTabRequest[] = [];
  const openedRefs: string[] = [];
  const gui = createTabGui({
    handlers: () => ({
      gui(request) {
        requests.push(request);
        // extension은 탭에 묶인 handle을 열어 core에 알린다.
        gui.opened(fakeHandle(request.terminal!.id, options.state));
      },
      tui: () => {},
      running: () => null,
      sessions: () => Promise.resolve([]),
      rewindPreview: () => Promise.resolve(null),
    }),
    ids: { request: () => "req_1" },
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
    images: options.images ?? NO_IMAGES,
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
  gui.onHandle((handle) => openedRefs.push(handle.terminal));
  const opened = () => openedRefs;
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

// 앱이 GUI가 띄운 CLI(extension host의 자식이라 shell_pid로 못 찾는다)를 session에 잇는 길이다. 이 표지가 빠지거나 extension
// host가 물려받은 값이 새면 앱이 엉뚱한 session에 process를 붙인다.
test("GUI가 띄우는 CLI는 그 탭의 session 표지를 받고 extension host가 물려받은 표지는 받지 않는다", async () => {
  const t = setup();
  t.line(KEY_A, { cwd: "/work/a" });
  await t.settle();
  const given = t.requests[0]?.terminal?.env;
  assert.equal(given?.LOPHN_SESSION_ID, "term:trm_a");
  const env = cliEnv({
    base: { PATH: "/usr/bin", LOPHN_SESSION_ID: "ses_from_host" },
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

  t.line(KEY_A, {
    cwd: "/work/a",
    resume: "abc-1",
    args: ["--dangerously-skip-permissions"],
  });
  await t.settle();
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0]?.terminal?.id, "trm_a");
  assert.equal(t.requests[0]?.terminal?.cwd, "/work/a");
  assert.equal(t.requests[0]?.resume, "abc-1");
  assert.deepEqual(t.requests[0]?.args, ["--dangerously-skip-permissions"]);
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
    t.requests.map((request) => request.terminal?.id),
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

// handle은 창과 상관없이 core에 있어 볼 창이 없어도 GUI로 남아야 한다. 반대로 TUI를 끄지 못했는데 GUI가 시작된 것처럼 두면
// 한 CLI session에 process 둘이 뜰 수 있다(harness-gui 불변식 6).
test("GUI 전환은 창 없이 GUI로 남고, TUI를 끄지 못하면 handle을 닫아 failed로 끝나며 TUI는 그대로다", async () => {
  const typed: string[] = [];
  let tuiAlive = true;
  let exitFails = false;
  let started = false;
  const handles: { handle: TabHandle; closed: () => boolean }[] = [];
  const gui = createTabGui({
    handlers: () => ({
      // extension의 길: handle을 열고, foreground TUI를 끈 뒤에야 adapter를 시작한다. 실패는 handle의 실패한 turn이다.
      gui(request) {
        const opened = liveHandle(request.terminal!.id, handles.length);
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
    ids: { request: () => "req_1" },
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
    images: NO_IMAGES,
    log: () => {},
  });
  const toggle = () => gui.toggle({ terminal_ref: "trm_a", to: "gui" });

  assert.deepEqual(await toggle(), { ok: true });
  assert.equal(handles[0]?.closed(), false);
  assert.equal(gui.current("trm_a")?.view, "gui");
  handles[0]?.handle.close();

  tuiAlive = true;
  started = false;
  exitFails = true;
  assert.deepEqual(await toggle(), {
    ok: false,
    reason: "failed",
    message: "did not exit",
  });
  assert.equal(handles[1]?.closed(), true);
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

const AT = "2026-11-15T00:00:00.000Z";
const tool = (
  id: string,
  body: AcpToolItem["body"],
  by: AcpToolItem["by"] = "agent",
): AcpToolItem => ({
  id,
  seq: 1,
  at: AT,
  kind: "tool",
  by,
  turn: null,
  tool: "shell.run",
  category: "command",
  title: id,
  state: "ok",
  duration_ms: null,
  detail: { kind: "generic" },
  body,
});
const bodyOf = (text: string) => ({
  input: `${text} in`,
  output: `${text} out`,
  truncated: false,
});

// 긴 coding session의 snapshot은 대부분이 tool 본문이라 폰 frame 한도(16 MiB)에 걸린다. 본문이 새면 그 한도로 다시 돌아가고,
// 본문 read가 다른 tool의 것을 주면 펼친 줄에 남의 출력이 보인다.
test("coding session의 snapshot에는 tool 본문이 없고 본문 read가 그 tool의 것만 준다", () => {
  const state: AcpState = {
    ...EMPTY_ACP_STATE,
    items: [
      tool("t1", bodyOf("one")),
      tool("t2", bodyOf("two"), "user"),
      {
        id: "h1",
        seq: 3,
        at: AT,
        kind: "hidden",
        checkpoint: "m1",
        choice: "messages_only",
        count: 1,
        restored: 0,
        left: [],
        items: [tool("t3", bodyOf("three"))],
      },
    ],
    children: {
      c1: {
        ...EMPTY_ACP_STATE,
        items: [tool("t4", bodyOf("four"))],
      } as AcpState["children"][string],
    },
  };
  const t = setup({ state: () => state });
  const listeners: Parameters<TabHandle["attach"]>[0][] = [];
  const handle: TabHandle = {
    ...fakeHandle("trm_a", () => state),
    attach(listener) {
      listener.snapshot(state);
      listeners.push(listener);
      return () => {};
    },
  };
  t.gui.opened(handle);

  const sent: unknown[] = [];
  const timers: (() => void)[] = [];
  attachBatched(
    handle,
    (_ms, run) => {
      timers.push(run);
      return () => {};
    },
    {
      snapshot: (snapshot) => sent.push(snapshot),
      updates: (updates) => sent.push(...updates),
      closed: () => {},
    },
  );
  for (const listener of listeners) {
    listener.update({ type: "tool_started", item: tool("t5", bodyOf("five")) });
    listener.update({
      type: "tool_ended",
      tool_call: "t5",
      state: "ok",
      at: AT,
      detail: null,
      body: bodyOf("five"),
    });
    listener.update({
      type: "child_update",
      child: "c1",
      update: { type: "tool_started", item: tool("t6", bodyOf("six")) },
    });
  }
  for (const run of timers.splice(0)) run();
  const wire = JSON.stringify(sent);
  for (const word of ["one", "three", "four", "five", "six", "two out"]) {
    assert.equal(wire.includes(word), false, word);
  }
  // 사람이 친 명령은 그 줄에 명령 전체를 보이므로 명령 글만 남는다.
  assert.equal(wire.includes("two in"), true);

  for (const [id, part, value] of [
    ["t1", "output", "one out"],
    ["t2", "output", "two out"],
    ["t3", "input", "three in"],
    ["t4", "output", "four out"],
  ] as const) {
    assert.deepEqual(t.gui.toolBody("trm_a", id, part), {
      value,
      truncated: false,
    });
  }
  assert.equal(t.gui.toolBody("trm_a", "t9", "output"), null);
  assert.equal(t.gui.toolBody("trm_other", "t1", "output"), null);
});

// 폰과 창이 준 이름은 믿을 수 없는 글이다. 그림이 탭 임시 폴더 밖에 쓰이거나 그 밖의 file이 읽히면 사람의 file을 덮거나 내보낸다.
test("폰이 보낸 그림이 그 탭의 임시 폴더 밖에 쓰이지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-gui-test-"));
  try {
    const t = setup({
      images: {
        root,
        async write(path, data) {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, data);
        },
        read: (path) =>
          readFile(path).then(
            (data) => new Uint8Array(data),
            () => null,
          ),
      },
    });
    t.gui.opened(fakeHandle("trm_a"));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const written: string[] = [];
    for (const name of [
      "phone-image",
      "../../escape.png",
      "/etc/x.png",
      "..",
    ]) {
      const path = await t.gui.uploadImage("trm_a", { name, data: png });
      assert.notEqual(path, null, name);
      assert.equal(dirname(path!), join(root, "trm_a"), name);
      assert.match(path!, /\.(png|jpe?g|gif|webp)$/);
      written.push(path!);
    }
    assert.equal(
      await t.gui.uploadImage("trm_a", {
        name: "x.png",
        data: new TextEncoder().encode("#!/bin/sh"),
      }),
      null,
    );
    assert.deepEqual((await readdir(root)).sort(), ["trm_a"]);
    assert.equal((await readdir(join(root, "trm_a"))).length, written.length);

    assert.deepEqual(await t.gui.readImage("trm_a", written[0]!), {
      mime: "image/png",
      data: png,
    });
    await writeFile(join(root, "outside.png"), png);
    await mkdir(join(root, "trm_b"));
    await writeFile(join(root, "trm_b", "other.png"), png);
    for (const path of [
      join(root, "outside.png"),
      join(root, "trm_b", "other.png"),
      join(root, "trm_a", "..", "outside.png"),
    ]) {
      assert.equal(await t.gui.readImage("trm_a", path), null, path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coding_sessions/switch rejects with conflict when stops changed since switch_plan", async () => {
  const ulid = "01AAAAAAAAAAAAAAAAAAAAAAAA";
  const terminalRef = `trm_${ulid}`;
  const sessionId = `ses_${ulid}`;
  const toggled: { terminal_ref: string; to: "gui" | "tui" }[] = [];
  let view: "tui" | "gui" = "tui";
  let tuiState: "idle" | "running" | "waiting" = "idle";
  let guiState: AcpState = EMPTY_ACP_STATE;
  const handle = fakeHandle(terminalRef, () => guiState);
  const runtime = (): TerminalRuntime =>
    ({
      terminal_ref: terminalRef,
      project: `prj_${ulid}`,
      cwd_at_start: "/work",
      state: "running",
      generation: 1,
      agent: {
        harness: "antigravity",
        state: tuiState,
        hooked: true,
        foreground: true,
        session: "conv-1",
      },
    }) as TerminalRuntime;

  const coding = createCodingSessions({
    clock: manualClock(0),
    terminals: { list: () => [runtime()] },
    gui: {
      request: async () => null,
      opened: () => {},
      onHandle: () => () => {},
      running: () => null,
      toggle: async (input) => {
        toggled.push(input);
        view = input.to;
        return { ok: true };
      },
      sessions: async () => [],
      rewindPreview: async () => null,
      current: () => (view === "gui" ? { handle, view: "gui" } : null),
      tabSessions: () =>
        view === "gui"
          ? [
              {
                terminal_ref: terminalRef,
                harness: "antigravity",
                view: "gui",
                handoff: "restart",
                title: null,
                cli_session: "conv-1",
                state: guiState.turn?.phase === "working" ? "running" : "idle",
              },
            ]
          : [],
      input: () => false,
      toolBody: () => null,
      uploadImage: async () => null,
      readImage: async () => null,
      terminalChanged: () => {},
      stop: () => {},
    },
    after: () => () => {},
    publish: () => {},
    redact: (value) => value,
    platform: "linux",
  });

  // 1) TUI idle 계획을 확인한 뒤 turn이 시작하면 conflict로 거절하고 toggle하지 않는다.
  const idlePlan = coding.switchPlan(sessionId);
  assert.ok(idlePlan.ok);
  assert.deepEqual(idlePlan.value.stops, { turn: false, tasks: 0, queued: 0 });

  tuiState = "running";
  const stale = await coding.switch({
    session: sessionId,
    to: "gui",
    key: "k-stale",
    stops: idlePlan.value.stops,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, "conflict");
    assert.equal(stale.error.details?.reason, "stale_plan");
  }
  assert.deepEqual(toggled, []);

  // 실패한 key는 풀리고, 새 계획(turn: true)으로 다시 확인하면 바뀐다.
  const runningPlan = coding.switchPlan(sessionId);
  assert.ok(runningPlan.ok);
  assert.deepEqual(runningPlan.value.stops, {
    turn: true,
    tasks: 0,
    queued: 0,
  });
  const switched = await coding.switch({
    session: sessionId,
    to: "gui",
    key: "k-stale",
    stops: runningPlan.value.stops,
  });
  assert.deepEqual(switched, { ok: true, value: { ok: true } });
  assert.deepEqual(toggled, [{ terminal_ref: terminalRef, to: "gui" }]);

  // 2) GUI → TUI에서도 계획 확인 뒤 메시지가 줄 서면 conflict다.
  const guiIdlePlan = coding.switchPlan(sessionId);
  assert.ok(guiIdlePlan.ok);
  assert.deepEqual(guiIdlePlan.value.stops, {
    turn: false,
    tasks: 0,
    queued: 0,
  });
  guiState = {
    ...EMPTY_ACP_STATE,
    queued: [{ id: "q1", at: AT, content: [{ type: "text", text: "hi" }] }],
  };
  const staleGui = await coding.switch({
    session: sessionId,
    to: "tui",
    key: "k-gui-stale",
    stops: guiIdlePlan.value.stops,
  });
  assert.equal(staleGui.ok, false);
  if (!staleGui.ok) {
    assert.equal(staleGui.error.code, "conflict");
    assert.equal(staleGui.error.details?.reason, "stale_plan");
  }
  assert.equal(toggled.length, 1);

  // stops를 생략한 옛 호출자는 계속 동작한다.
  const compat = await coding.switch({
    session: sessionId,
    to: "tui",
    key: "k-compat",
  });
  assert.deepEqual(compat, { ok: true, value: { ok: true } });
});

test("GUI ACP session title updates persist to AgentSessionStore without overwriting a user-pinned name", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-gui-title-"));
  const prj = "prj_01AAAAAAAAAAAAAAAAAAAAAAAA";
  const terminalRef = "trm_01AAAAAAAAAAAAAAAAAAAAAAAA";
  try {
    const store = createAgentSessionStore({
      dataRoot: root,
      now: () => 1000,
      resumable: () => true,
    });
    const rt = {
      terminal_ref: terminalRef,
      project: prj,
      folder_ref: `${prj}_0`,
      cwd_at_start: "/work",
      state: "running",
      generation: 1,
    } as TerminalRuntime;
    const terminals: Terminals = {
      open: async () => ({ ok: true, value: rt }),
      close: async () => ({ ok: true, value: rt }),
      restart: async () => ({ ok: true, value: rt }),
      write: async () => ({ ok: true, value: undefined }),
      signal: async () => ({ ok: true, value: undefined }),
      resize: async () => ({ ok: true, value: rt }),
      snapshot: async () => ({ ok: true, value: { runtime: rt, output: [] } }),
      screen: async () => ({ ok: true, value: {} as never }),
      list: () => [rt],
      runtime: (ref) => (ref === terminalRef ? rt : null),
      patch: () => {},
      onRuntime: () => () => {},
      onOutput: () => () => {},
      onForeground: () => () => {},
      onHumanInput: () => () => {},
      useEnv: () => () => {},
      anyOpen: () => true,
      stop: async () => {},
    };
    const agents = createTerminalAgents({
      terminals,
      clock: manualClock(1000),
      after: () => () => {},
      publish: () => {},
      attention: () => ({ signal: () => {}, dismiss: () => {} }),
      handlers: () => null,
      redact: (value) => value,
      platform: "linux",
      store,
      images: NO_IMAGES,
      ids: { request: () => "req_1" },
      hookEnv: () => ({}),
      identified: () => {},
      beat: () => {},
      log: () => {},
    });

    let state: AcpState = EMPTY_ACP_STATE;
    const listeners = new Set<Parameters<TabHandle["attach"]>[0]>();
    const handle: TabHandle = {
      id: "win_1",
      terminal: terminalRef,
      harness: "antigravity",
      handoff: "restart",
      cwd: "/work",
      state: () => state,
      attach(listener) {
        listener.snapshot(state);
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      input: () => {},
      close: () => {},
    };
    agents.opened(handle);

    const emitSession = (title: string | null) => {
      state = {
        ...state,
        session: {
          cli_session: "conv-1",
          title,
        } as unknown as AcpState["session"],
      };
      for (const listener of listeners) {
        listener.update({
          type: "session_changed",
          session: { cli_session: "conv-1", title },
        });
      }
    };
    emitSession("Generated ACP Title");
    await new Promise((resolve) => setTimeout(resolve, 20));
    let saved = await store.list(prj);
    assert.equal(saved[0]?.external_session, "conv-1");
    assert.equal(saved[0]?.title, "Generated ACP Title");
    assert.equal(saved[0]?.name, "Generated ACP Title");

    // 사람이 이름을 고정하면 이후 ACP 제목 갱신이 덮어쓰지 않는다.
    const renamed = await agents.renameSaved({
      project: prj,
      harness: "antigravity",
      external_session: "conv-1",
      name: "My Pinned Title",
    });
    assert.equal(renamed.ok, true);
    emitSession("Later ACP Title");
    await new Promise((resolve) => setTimeout(resolve, 20));
    saved = await store.list(prj);
    assert.equal(saved[0]?.name, "My Pinned Title");
    assert.equal(saved[0]?.pinned, true);
    agents.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gui.toggle passes launch args from TUI to AcpTabRequest and seeds resumingTui on GUI->TUI restart", async () => {
  const requests: AcpTabRequest[] = [];
  const resumed: { ref: string; harness: string; session: string }[] = [];
  let opened: ReturnType<typeof liveHandle> | null = null;
  const gui = createTabGui({
    handlers: () => ({
      gui(request) {
        requests.push(request);
        opened = liveHandle(request.terminal!.id, 1);
        const origState = opened.handle.state;
        opened.handle.state = () => ({
          ...origState(),
          session: {
            cli_session: "conv-1",
            title: "My Chat",
          } as unknown as AcpState["session"],
        });
        gui.opened(opened.handle);
      },
      tui() {
        opened?.handle.close();
      },
      running: () => ({ turn: false, tasks: 0 }),
      sessions: async () => [],
      rewindPreview: async () => null,
    }),
    ids: { request: () => "req_1" },
    terminals: {
      runtime: () => ({ cwd: "/work", generation: 1 }),
      hookEnv: () => ({}),
      tui: () => ({
        harness: "antigravity",
        state: "idle",
        session: "conv-1",
        cwd: "/work",
        args: ["--dangerously-skip-permissions"],
      }),
      type: async () => {},
      signal: async () => {},
      onForegroundExit: () => () => {},
    },
    images: NO_IMAGES,
    log: () => {},
    resumingTui: (ref, harness, session) =>
      resumed.push({ ref, harness, session }),
  });

  assert.deepEqual(await gui.toggle({ terminal_ref: "trm_a", to: "gui" }), {
    ok: true,
  });
  assert.deepEqual(requests[0]?.args, ["--dangerously-skip-permissions"]);
  assert.equal(requests[0]?.resume, "conv-1");

  assert.deepEqual(await gui.toggle({ terminal_ref: "trm_a", to: "tui" }), {
    ok: true,
  });
  assert.deepEqual(resumed, [
    { ref: "trm_a", harness: "claude", session: "conv-1" },
  ]);
});

test("createCodingSessions.list includes Home (project: home) terminals and filters by project", () => {
  const terminalRef = "trm_01HHHHHHHHHHHHHHHHHHHHHHHH";
  const rt = {
    terminal_ref: terminalRef,
    project: "home",
    folder_ref: "home_0",
    cwd_at_start: "/home/person",
    state: "running",
    generation: 1,
    agent: {
      harness: "claude",
      state: "idle",
      hooked: true,
      foreground: true,
      session: "cli-home",
    },
  } as TerminalRuntime;

  const coding = createCodingSessions({
    clock: manualClock(0),
    terminals: { list: () => [rt] },
    gui: {
      request: async () => null,
      opened: () => {},
      onHandle: () => () => {},
      running: () => null,
      toggle: async () => ({ ok: true }),
      sessions: async () => [],
      rewindPreview: async () => null,
      current: () => null,
      tabSessions: () => [],
      input: () => false,
      toolBody: () => null,
      uploadImage: async () => null,
      readImage: async () => null,
      terminalChanged: () => {},
      stop: () => {},
    },
    after: () => () => {},
    publish: () => {},
    redact: (value) => value,
    platform: "linux",
  });

  const all = coding.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.project, "home");
  assert.equal(all[0]?.terminal, terminalRef);
  assert.equal(coding.list("home").length, 1);
  assert.equal(coding.list(`prj_${"0".repeat(26)}`).length, 0);
});
