import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodingOpen } from "./coding-open.ts";
import type { GuiTabSession, TabHandle } from "./gui.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const OLD = `trm_${"1".repeat(26)}`;
const NEW = `trm_${"2".repeat(26)}`;

const handle = (terminal: string) =>
  ({ terminal, harness: "claude" }) as TabHandle;

function setup(sessions: GuiTabSession[]) {
  const listeners = new Set<(handle: TabHandle) => void>();
  const opened: unknown[] = [];
  const open = createCodingOpen({
    gui: {
      onHandle(listener) {
        listeners.add(listener);
        listener(handle(OLD));
        return () => void listeners.delete(listener);
      },
      tabSessions: () => sessions,
    },
    projectOf: () => PROJECT,
    openTab(input) {
      opened.push(input);
      // 창이 탭을 열면 그 터미널의 `claude gui`가 handle을 연다.
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener(handle(NEW));
      });
      return Promise.resolve(true);
    },
    after: () => () => {},
  });
  return { open, opened, listeners };
}

// 한 CLI session에 process 둘이 붙으면 대화 기록이 엇갈려 망가진다.
test("이미 GUI 탭에서 도는 CLI session을 resume으로 열면 conflict이고 탭을 열지 않는다", async () => {
  const { open, opened } = setup([
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
    resume: "cli-1",
  });
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.code, "conflict");
  assert.deepEqual(opened, []);
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
