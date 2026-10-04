import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalReply, TerminalRuntime } from "../../ipc/terminal.ts";
import { createSupervisor, type HostProcess } from "./supervisor.ts";

function runtime(state: TerminalRuntime["state"]): TerminalRuntime {
  return {
    terminal_ref: "term_1",
    project: "prj_1",
    folder_ref: "fld_a",
    cwd_at_start: "/work/a",
    program_path: "/bin/bash",
    launch_kind: "shell",
    state,
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 0,
    dropped_output: false,
  };
}

function fakeHost(): HostProcess & {
  lines: string[];
  exit: (code: number | null) => void;
} {
  const listeners: Array<(code: number | null) => void> = [];
  const host = {
    lines: [] as string[],
    killed: false,
    stdin: {
      write(data: string) {
        host.lines.push(data);
      },
    },
    // 빈 iterable이어야 supervisor의 줄 읽기가 끝나지 않고 기다리며 테스트를 붙잡지 않는다.
    stdout: (async function* () {})(),
    kill() {
      host.killed = true;
      return true;
    },
    on(event: "exit", listener: (code: number | null) => void) {
      if (event === "exit") listeners.push(listener);
    },
    exit(code: number | null) {
      for (const listener of listeners) listener(code);
    },
  };
  return host;
}

test("shell/terminal#R9: host exit는 살아 있던 터미널을 unknown으로 두고 다시 띄우지 않는다", () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  supervisor.note(runtime("running"));
  child.exit(null);
  const [gone] = supervisor.runtimes();
  assert.equal(gone?.state, "unknown");
  assert.equal(gone?.failure_reason, "host_lost");
  assert.equal(gone?.exit_code, null);
  assert.equal(child.killed, false);
});

test("shell/terminal#R10: Electron 종료는 host에 종료를 보내고 확인 전 running을 성공으로 두지 않는다", () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  supervisor.note(runtime("running"));
  const gone = supervisor.stop();
  assert.equal(child.killed, true);
  assert.equal(gone[0]?.state, "unknown");
  assert.equal(gone[0]?.failure_reason, "host_lost");
});

test("shell/terminal#R9: host가 이미 없으면 요청은 host_lost이고 입력을 보관하지 않는다", async () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  child.exit(1);
  const reply: TerminalReply = await supervisor.request({
    type: "input",
    text: "echo secret",
  });
  assert.equal(reply.ok, false);
  if (reply.ok) return;
  assert.equal(reply.reason, "host_lost");
  assert.equal(JSON.stringify(child.lines).includes("secret"), false);
});
