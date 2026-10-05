// shell/terminal#R7, R8, R9: renderer가 다시 붙을 때 host는 지금 runtime과
// after_seq 뒤의 출력만 준다. 종료·exit code는 같은 답에 실린다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PtyHandle } from "../../terminal-host/pty.ts";
import { createHost } from "../../terminal-host/main.ts";

function hostWithPush() {
  let push: ((chunk: string) => void) | undefined;
  let exit: ((value: { exitCode: number }) => void) | undefined;
  const host = createHost({
    pty: {
      spawn(): PtyHandle {
        return {
          pid: 9,
          write() {},
          resize() {},
          kill() {},
          onData(listener) {
            push = listener;
            return { dispose() {} };
          },
          onExit(listener) {
            exit = listener;
            return { dispose() {} };
          },
        };
      },
      group: () => ({
        pid: 9,
        alive: () => false,
        kill: () => ({ confirmed: true }),
      }),
    },
    env: { SHELL: "/bin/bash", PATH: "/usr/bin" },
    platform: "linux",
    exists: (file) => file === "/bin/bash",
    checkFolder: (path) => ({ ok: true, path }),
    schedule: (done) => done(),
  });
  return {
    host,
    push: (chunk: string) => push?.(chunk),
    exit: (code: number) => exit?.({ exitCode: code }),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("shell/terminal#R8: snapshot은 runtime과 after_seq 뒤의 출력만 준다", async () => {
  const { host, push } = hostWithPush();
  host.handle({
    id: "1",
    type: "open",
    project: "prj_1",
    folders: [{ folder_ref: "prj_1_0", path: "/work/a" }],
    columns: 80,
    rows: 24,
  });
  push("one\n");
  push("two\n");
  push("three\n");
  await tick();
  const all = await host.handle({
    id: "s",
    type: "snapshot",
    terminal_ref: "term_1",
  });
  assert.equal(all.ok, true);
  if (!all.ok || !("output" in all)) return;
  assert.equal(all.runtime.state, "running");
  assert.deepEqual(all.output.map((item) => item.chunk), [
    "one\n",
    "two\n",
    "three\n",
  ]);
  const rest = await host.handle({
    id: "s2",
    type: "snapshot",
    terminal_ref: "term_1",
    after_seq: all.output[1]!.seq,
  });
  if (!rest.ok || !("output" in rest)) return assert.fail("no snapshot");
  assert.deepEqual(rest.output.map((item) => item.chunk), ["three\n"]);
});

test("shell/terminal#R9: 종료한 shell의 snapshot은 확인된 exit code를 싣는다", async () => {
  const { host, push, exit } = hostWithPush();
  host.handle({
    id: "1",
    type: "open",
    project: "prj_1",
    folders: [{ folder_ref: "prj_1_0", path: "/work/a" }],
    columns: 80,
    rows: 24,
  });
  push("bye\n");
  await tick();
  exit(3);
  const snap = await host.handle({
    id: "s",
    type: "snapshot",
    terminal_ref: "term_1",
  });
  if (!snap.ok || !("output" in snap)) return assert.fail("no snapshot");
  assert.equal(snap.runtime.state, "exited");
  assert.equal(snap.runtime.exit_code, 3);
  assert.deepEqual(snap.output.map((item) => item.chunk), ["bye\n"]);
});
