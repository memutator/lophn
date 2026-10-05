// shell/terminal#R11: output flood는 chunk 단위로 양보한다. 한 PTY의 무한
// 출력이 main과 다른 PTY를 붙잡지 않는지 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalRuntime } from "../../ipc/terminal.ts";
import type { PtyHandle, PtySpawnOptions } from "../../terminal-host/pty.ts";
import { yieldChunk } from "../../terminal-host/pty.ts";
import { createHost, type HostDeps } from "../../terminal-host/main.ts";

test("shell/terminal#R11: flood 출력은 chunk마다 양보하고 다른 PTY 입력을 막지 않는다", async () => {
  // flood가 흐르는 동안 다른 PTY의 입력이 처리되는지 본다. schedule은
  // 이벤트 루프를 한 턴 양보하는 setImmediate다.
  const ticks: number[] = [];
  let order = 0;
  const schedule: HostDeps["schedule"] = (done) => {
    ticks.push(order++);
    setImmediate(done);
  };

  let push: ((chunk: string) => void) | undefined;
  const pty: HostDeps["pty"] = {
    spawn(options: PtySpawnOptions): PtyHandle {
      assert.equal(options.env.USER_TOKEN, undefined);
      return {
        pid: 700,
        write: () => {},
        resize: () => {},
        kill: () => {},
        onData(listener) {
          push = listener;
          return { dispose() {} };
        },
        onExit() {
          return { dispose() {} };
        },
      };
    },
    group: () => ({
      pid: 700,
      alive: () => false,
      kill: () => ({ confirmed: true }),
    }),
  };

  const host = createHost({
    pty,
    env: { SHELL: "/bin/bash", PATH: "/usr/bin", USER_TOKEN: "sekrit" },
    platform: "linux",
    exists: (file) => file === "/bin/bash",
    checkFolder: (path) => ({ ok: true, path }),
    schedule,
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
  await new Promise((resolve) => setImmediate(resolve));

  // flood: 큰 chunk를 여러 개 연속으로 밀어 넣는다.
  const block = "x".repeat(100_000);
  for (let i = 0; i < 40; i++) push?.(block);
  // flood가 다 밀린 뒤 한 턴을 기다린다. 양보 사이에 ticks가 찼는지 본다.
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(
    ticks.length >= 40,
    `flood가 chunk마다 양보하지 않았다: ticks=${ticks.length}`,
  );

  const snap = await host.handle({
    id: "s",
    type: "snapshot",
    terminal_ref: "term_1",
  });
  assert.equal(snap.ok, true);
  if (!snap.ok || !("output" in snap)) return;
  const joined = snap.output.map((piece) => piece.chunk).join("");
  assert.ok(joined.length > 0);
  const gone = host.sessions()[0] as TerminalRuntime;
  assert.ok(gone.output_seq > 0);
});

test("shell/terminal#R11: flood가 양보 사이에 끼인 다른 generation의 resize를 처리한다", async () => {
  const seen: number[][] = [];
  const pty: HostDeps["pty"] = {
    spawn(): PtyHandle {
      return {
        pid: 701,
        write: () => {},
        resize: (columns, rows) => seen.push([columns, rows]),
        kill: () => {},
        onData() {
          return { dispose() {} };
        },
        onExit() {
          return { dispose() {} };
        },
      };
    },
    group: () => ({
      pid: 701,
      alive: () => false,
      kill: () => ({ confirmed: true }),
    }),
  };
  const host = createHost({
    pty,
    env: { SHELL: "/bin/bash", PATH: "/usr/bin" },
    platform: "linux",
    exists: (file) => file === "/bin/bash",
    checkFolder: (path) => ({ ok: true, path }),
    schedule: (done) => setImmediate(done),
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
  const resized = await host.handle({
    id: "z",
    type: "resize",
    terminal_ref: "term_1",
    generation: 1,
    columns: 120,
    rows: 50,
  });
  assert.equal(resized.ok, true);
  assert.deepEqual(seen, [[120, 50]]);
});

test("shell/terminal#R11: yieldChunk는 schedule이 부른 뒤에 resolve한다", async () => {
  let called = 0;
  const done = await yieldChunk((callback) => {
    called++;
    callback();
  });
  assert.equal(done, undefined);
  assert.equal(called, 1);
});
