// shell#T24: secret 모양 출력이 진단으로 나가지 않고, host crash는 unknown이다.
// 실제 Electron 창의 PTY는 contracts#T10 harness 위에서 아직 띄우지 않는다.
// renderer 터미널 화면(shell#T25)이 생기기 전에는 창에 붙일 IPC가 없다.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHost } from "../../apps/shell/terminal-host/main.ts";
import type {
  PtyHandle,
  PtySpawnOptions,
} from "../../apps/shell/terminal-host/pty.ts";
import {
  createSupervisor,
  type HostProcess,
} from "../../apps/shell/main/terminal/supervisor.ts";
import type { TerminalRuntime } from "../../apps/shell/ipc/terminal.ts";

test("shell/terminal#R5: secret 모양 출력은 host 메모리 밖에 진단으로 나가지 않는다", async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    let push: ((chunk: string) => void) | undefined;
    const host = createHost({
      pty: {
        spawn(options: PtySpawnOptions): PtyHandle {
          assert.equal(options.env.USER_TOKEN, undefined);
          return {
            pid: 9,
            write() {},
            resize() {},
            kill() {},
            onData(listener) {
              push = listener;
              return { dispose() {} };
            },
            onExit() {
              return { dispose() {} };
            },
          };
        },
        group() {
          return {
            pid: 9,
            alive: () => false,
            kill: () => ({ confirmed: true }),
          };
        },
      },
      env: {
        SHELL: "/bin/bash",
        PATH: "/usr/bin",
        USER_TOKEN: "sk-live-secret",
      },
      platform: "linux",
      exists: (file) => file === "/bin/bash",
      checkFolder: (path) => ({ ok: true, path }),
      schedule: (done) => done(),
    });
    const opened = await host.handle({
      id: "1",
      type: "open",
      project: "prj_1",
      folders: [{ folder_ref: "fld_a", path: "/work/a" }],
      columns: 80,
      rows: 24,
    });
    assert.equal(opened.ok, true);
    await new Promise((r) => setImmediate(r));
    push?.("token=sk-live-secret\n");
    await new Promise((r) => setImmediate(r));
    const snap = await host.handle({
      id: "s",
      type: "snapshot",
      terminal_ref: "term_1",
    });
    assert.equal(snap.ok, true);
    assert.equal(logs.join("\n").includes("sk-live-secret"), false);
  } finally {
    console.log = original;
  }
});

test("shell/terminal#R9: host crash는 결과 불명이고 shell을 자동으로 다시 시작하지 않는다", () => {
  const listeners: Array<(code: number | null) => void> = [];
  const child: HostProcess = {
    stdin: { write() {} },
    stdout: (async function* () {})(),
    killed: false,
    kill() {
      return true;
    },
    on(_event, listener) {
      listeners.push(listener);
    },
  };
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  const running: TerminalRuntime = {
    terminal_ref: "term_1",
    project: "prj_1",
    folder_ref: "fld_a",
    cwd_at_start: "/work/a",
    program_path: "/bin/bash",
    launch_kind: "shell",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 3,
    dropped_output: false,
  };
  void supervisor.request({ type: "open" });
  supervisor.note(running);
  for (const listener of listeners) listener(null);
  const [gone] = supervisor.runtimes();
  assert.equal(gone?.state, "unknown");
  assert.equal(gone?.failure_reason, "host_lost");
  assert.equal(supervisor.runtimes().length, 1);
});
