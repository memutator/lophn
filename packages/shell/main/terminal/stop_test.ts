// shell/terminal#R10: 사람이 확인한 닫기는 SIGHUP 뒤 group 종료를 기다려 확인한다.
// 대화형 shell처럼 신호 직후에는 아직 살아 있어도 성공 추정이나 즉시 결과 불명이
// 아니다. 끝내 살아 있으면 SIGKILL 뒤 다시 보고, 그래도 살아 있으면 결과 불명이다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PtyHandle } from "../../terminal-host/pty.ts";
import { createHost } from "../../terminal-host/main.ts";

function hostWith(group: {
  kill: (signal?: string) => { confirmed: true } | {
    confirmed: false;
    reason: string;
  };
  alive: () => boolean;
}) {
  const signals: string[] = [];
  const host = createHost({
    pty: {
      spawn(): PtyHandle {
        return {
          pid: 7,
          write() {},
          resize() {},
          kill(signal) {
            signals.push(`pty:${signal}`);
          },
          onData: () => ({ dispose() {} }),
          onExit: () => ({ dispose() {} }),
        };
      },
      group: () => ({
        pid: 7,
        alive: group.alive,
        kill: (signal) => {
          signals.push(`group:${signal}`);
          return group.kill(signal);
        },
      }),
    },
    env: { SHELL: "/bin/bash", PATH: "/usr/bin" },
    platform: "linux",
    exists: (file) => file === "/bin/bash",
    checkFolder: (path) => ({ ok: true, path }),
    schedule: (done) => done(),
    sleep: () => Promise.resolve(),
  });
  host.handle({
    id: "1",
    type: "open",
    project: "prj_1",
    folders: [{ folder_ref: "prj_1_0", path: "/work/a" }],
    columns: 80,
    rows: 24,
  });
  return { host, signals };
}

test("shell/terminal#R10: SIGHUP 뒤 몇 턴 지나 끝난 shell은 종료 확인이다", async () => {
  let polls = 0;
  const { host, signals } = hostWith({
    kill: () => ({ confirmed: false, reason: "still_alive" }),
    alive: () => ++polls < 3,
  });
  const closed = await host.handle({
    id: "c",
    type: "close",
    terminal_ref: "term_1",
    generation: 1,
  });
  if (!closed.ok || !("runtime" in closed)) return assert.fail("no runtime");
  assert.equal(closed.runtime.state, "exited");
  assert.equal(closed.runtime.failure_reason, null);
  assert.deepEqual(signals, ["pty:SIGHUP", "group:SIGHUP"]);
});

test("shell/terminal#R10: SIGKILL 뒤에도 살아 있으면 결과 불명이다", async () => {
  const { host, signals } = hostWith({
    kill: () => ({ confirmed: false, reason: "still_alive" }),
    alive: () => true,
  });
  const closed = await host.handle({
    id: "c",
    type: "close",
    terminal_ref: "term_1",
    generation: 1,
  });
  if (!closed.ok || !("runtime" in closed)) return assert.fail("no runtime");
  assert.equal(closed.runtime.state, "unknown");
  assert.equal(closed.runtime.failure_reason, "kill_unconfirmed");
  assert.deepEqual(signals, ["pty:SIGHUP", "group:SIGHUP", "group:SIGKILL"]);
});
