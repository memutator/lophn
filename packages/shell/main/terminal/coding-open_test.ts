import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodingOpen } from "./coding-open.ts";
import type { GuiTabSession, TabHandle } from "./gui.ts";
import { createHarnessTui } from "./harness-tui.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const LEDGER = `ses_${"9".repeat(26)}`;
const OLD = `trm_${"1".repeat(26)}`;
const NEW = `trm_${"2".repeat(26)}`;

// closed를 부르면 attach한 쪽에 닫힘을 알리는 가짜 handle이다.
function fakeHandle(terminal: string) {
  const closers: (() => void)[] = [];
  const handle = {
    terminal,
    harness: "claude",
    attach(listener: { closed(): void }) {
      closers.push(() => listener.closed());
      return () => {};
    },
  } as unknown as TabHandle;
  return { handle, close: () => closers.forEach((close) => close()) };
}

function setup(sessions: GuiTabSession[]) {
  const listeners = new Set<(handle: TabHandle) => void>();
  const opened: unknown[] = [];
  const created = fakeHandle(NEW);
  const tui = createHarnessTui({ onForegroundExit: () => () => {} });
  const ends = new Map<string, () => void>();
  const open = createCodingOpen({
    gui: {
      onHandle(listener) {
        listeners.add(listener);
        listener(fakeHandle(OLD).handle);
        return () => void listeners.delete(listener);
      },
      tabSessions: () => sessions,
    },
    projectOf: () => PROJECT,
    openTab(input) {
      opened.push(input);
      // 창이 탭을 열면 그 터미널의 `claude gui`가 handle을 연다.
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener(created.handle);
      });
      return Promise.resolve(true);
    },
    after: () => () => {},
    hold: (key, session) => tui.holdGui(key, session),
    release: (key) => tui.releaseGui(key),
    onTerminalEnd: (terminalRef, run) => void ends.set(terminalRef, run),
  });
  return {
    open,
    opened,
    listeners,
    tui,
    close: created.close,
    end: (terminalRef: string) => ends.get(terminalRef)?.(),
  };
}

// 한 CLI session에 process 둘이 붙으면 대화 기록이 엇갈려 망가진다.
test("이미 GUI 탭에서 도는 CLI session을 resume으로 열면 conflict이고 탭을 열지 않는다", async () => {
  const { open, opened, tui } = setup([
    {
      terminal_ref: OLD,
      harness: "claude",
      view: "gui",
      handoff: "restart",
      title: null,
      cli_session: "cli-1",
      state: "idle",
    },
  ]);
  const done = await open({
    project: PROJECT,
    harness: "claude",
    resume: { session: LEDGER, cli_session: "cli-1" },
  });
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.code, "conflict");
  assert.deepEqual(opened, []);
  assert.deepEqual(tui.sessions(), []);
});

test("탭을 연 뒤 그 project에 새로 생긴 handle의 터미널을 돌려주고 이미 있던 handle은 보지 않는다", async () => {
  const { open, opened, listeners } = setup([]);
  const done = await open({ project: PROJECT, harness: "claude" });
  assert.deepEqual(done, { ok: true, terminal_ref: NEW });
  assert.deepEqual(opened, [
    { project: PROJECT, harness: "claude", resume: null },
  ]);
  assert.equal(listeners.size, 0);
});

// hold가 없으면 headless turn이 GUI가 쥔 CLI session에 둘째 process를 띄운다. 채팅을 터미널로 바꾸면 handle은 닫혀도
// 같은 CLI session을 그 터미널의 TUI가 이어 쓴다.
test("resume으로 연 session은 handle이 닫혀도 터미널이 살아 있으면 hold 목록에 있고 터미널이 끝나면 빠진다", async () => {
  const { open, opened, tui, close, end } = setup([]);
  const done = await open({
    project: PROJECT,
    harness: "claude",
    resume: { session: LEDGER, cli_session: "cli-1" },
  });
  assert.deepEqual(done, { ok: true, terminal_ref: NEW });
  assert.deepEqual(opened, [
    { project: PROJECT, harness: "claude", resume: "cli-1" },
  ]);
  assert.deepEqual(tui.sessions(), [LEDGER]);
  close();
  assert.deepEqual(tui.sessions(), [LEDGER]);
  end(NEW);
  assert.deepEqual(tui.sessions(), []);
});
