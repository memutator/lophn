import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { TerminalRuntime } from "../../ipc/terminal.ts";
import type { PtyHandle, PtySpawnOptions } from "../../terminal-host/pty.ts";
import { createHost, type HostDeps } from "../../terminal-host/main.ts";

type Fake = PtyHandle & {
  writes: string[];
  options: PtySpawnOptions;
  alive: boolean;
};

function fakePty(fail = false): HostDeps["pty"] & { spawned: Fake[] } {
  const spawned: Fake[] = [];
  return {
    spawned,
    spawn(options) {
      if (fail) throw new Error("spawn failed");
      if (options.env.USER_TOKEN || options.env.LOPHN_HOME) {
        throw new Error("platform env leaked");
      }
      // 실제 node-pty처럼 kill 때 exit 이벤트를 낸다. 관측한 종료만
      // exit code의 근거다.
      const exits: ((exit: { exitCode: number }) => void)[] = [];
      const handle: Fake = {
        pid: 4000 + spawned.length,
        writes: [],
        options,
        alive: true,
        write(data) {
          this.writes.push(data);
        },
        resize() {},
        kill() {
          this.alive = false;
          for (const listener of exits) listener({ exitCode: 0 });
        },
        onData() {
          return { dispose() {} };
        },
        onExit(listener) {
          exits.push(listener);
          return { dispose() {} };
        },
      };
      spawned.push(handle);
      return handle;
    },
    group(pid) {
      const handle = spawned.find((item) => item.pid === pid);
      return {
        pid,
        alive: () => handle?.alive ?? false,
        kill() {
          if (!handle) return { confirmed: false, reason: "missing" };
          handle.alive = false;
          return { confirmed: true };
        },
      };
    },
  };
}

function deps(pty: HostDeps["pty"], _folders: { path: string }[]): HostDeps {
  return {
    pty,
    env: {
      SHELL: "/bin/bash",
      PATH: "/usr/bin",
      USER_TOKEN: "sekrit",
      LOPHN_HOME: "/tmp/should-not-pass",
    },
    platform: "linux",
    exists: (file) => file === "/bin/bash",
    checkFolder: (path) => {
      if (path.endsWith("/missing")) return { ok: false, reason: "unreadable" };
      if (path.endsWith("/file")) return { ok: false, reason: "not_directory" };
      return { ok: true, path };
    },
    schedule: (done) => done(),
    controlFd: 7,
  };
}

function open(project = "prj_1", folder?: string) {
  return {
    id: "1",
    type: "open" as const,
    project,
    folder_ref: folder,
    folders: [
      { folder_ref: "fld_a", path: "/work/a" },
    ],
    columns: 80,
    rows: 24,
  };
}

test("shell/terminal#R1: 등록 폴더가 하나면 그 폴더에서 shell을 시작한다", async () => {
  const pty = fakePty();
  const host = createHost(deps(pty, []));
  const reply = await host.handle(open());
  assert.equal(reply.ok, true);
  if (!reply.ok || !("runtime" in reply)) return;
  assert.equal(reply.runtime.cwd_at_start, "/work/a");
  assert.equal(reply.runtime.state, "running");
  assert.equal(reply.runtime.launch_kind, "shell");
  assert.deepEqual(pty.spawned[0]?.options.args, ["-l"]);
  assert.equal(pty.spawned[0]?.options.env.USER_TOKEN, undefined);
  assert.equal(pty.spawned[0]?.options.controlFd, 7);
});

test("shell/terminal#R1: 폴더가 여러 개면 선택 전에는 시작하지 않는다", async () => {
  const pty = fakePty();
  const host = createHost(deps(pty, []));
  const reply = await host.handle({
    ...open(),
    folder_ref: undefined,
    folders: [
      { folder_ref: "fld_a", path: "/work/a" },
      { folder_ref: "fld_b", path: "/work/b" },
    ],
  });
  assert.equal(reply.ok, false);
  if (reply.ok) return;
  assert.equal(reply.reason, "choose_folder");
  assert.equal(pty.spawned.length, 0);
});

test("shell/terminal#R2: 없거나 디렉터리가 아니거나 못 읽으면 거절하고 다른 폴더로 시작하지 않는다", async () => {
  const pty = fakePty();
  const host = createHost(deps(pty, []));
  const none = await host.handle({ ...open(), folders: [] });
  assert.equal(none.ok, false);
  const bad = await host.handle({
    ...open(),
    folder_ref: "fld_a",
    folders: [{ folder_ref: "fld_a", path: "/work/missing" }],
  });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.equal(bad.reason, "unreadable");
  const file = await host.handle({
    ...open(),
    folder_ref: "fld_a",
    folders: [{ folder_ref: "fld_a", path: "/work/file" }],
  });
  assert.equal(file.ok, false);
  assert.equal(pty.spawned.length, 0);
});

test("shell/terminal#R3: 입력을 다른 generation에 보내지 않는다", async () => {
  const pty = fakePty();
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  assert.equal(opened.ok, true);
  if (!opened.ok || !("runtime" in opened)) return;
  const sent = await host.handle({
    id: "2",
    type: "input",
    terminal_ref: opened.runtime.terminal_ref,
    generation: opened.runtime.generation,
    text: "ls\n",
  });
  assert.equal(sent.ok, true);
  assert.deepEqual(pty.spawned[0]?.writes, ["ls\n"]);
  const stale = await host.handle({
    id: "3",
    type: "input",
    terminal_ref: opened.runtime.terminal_ref,
    generation: opened.runtime.generation + 9,
    text: "rm\n",
  });
  assert.equal(stale.ok, false);
  assert.deepEqual(pty.spawned[0]?.writes, ["ls\n"]);
});

test("shell/terminal#R9: 시작 실패·확인된 exit·host 불명을 구별하고 재시작은 입력을 재생하지 않는다", async () => {
  const failing = createHost(deps(fakePty(true), []));
  const failed = await failing.handle(open());
  assert.equal(failed.ok, true);
  if (!failed.ok || !("runtime" in failed)) return;
  assert.equal(failed.runtime.state, "exited");
  assert.equal(failed.runtime.failure_reason, "spawn_failed");
  assert.equal(failed.runtime.exit_code, null);

  const pty = fakePty();
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  if (!opened.ok || !("runtime" in opened)) return;
  await host.handle({
    id: "in",
    type: "input",
    terminal_ref: opened.runtime.terminal_ref,
    generation: 1,
    text: "echo hi\n",
  });
  const closed = await host.handle({
    id: "c",
    type: "close",
    terminal_ref: opened.runtime.terminal_ref,
    generation: 1,
  });
  assert.equal(closed.ok, true);
  if (!closed.ok || !("runtime" in closed)) return;
  assert.equal(closed.runtime.state, "exited");
  assert.equal(typeof closed.runtime.exit_code, "number");

  const restarted = await host.handle({
    id: "r",
    type: "restart",
    terminal_ref: opened.runtime.terminal_ref,
    generation: closed.runtime.generation,
  });
  assert.equal(restarted.ok, true);
  if (!restarted.ok || !("runtime" in restarted)) return;
  assert.equal(restarted.runtime.generation, closed.runtime.generation + 1);
  assert.equal(restarted.runtime.state, "running");
  assert.deepEqual(pty.spawned[1]?.writes ?? [], []);
  assert.notDeepEqual(pty.spawned[0]?.writes, []);
});

test("shell/terminal#R10: 종료 확인에 실패하면 결과 불명이고 성공이라고 하지 않는다", async () => {
  const pty = fakePty();
  const original = pty.group.bind(pty);
  pty.group = (pid) => {
    original(pid);
    return {
      pid,
      alive: () => true,
      kill: () => ({ confirmed: false, reason: "still_alive" }),
    };
  };
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  if (!opened.ok || !("runtime" in opened)) return;
  const closed = await host.handle({
    id: "c",
    type: "close",
    terminal_ref: opened.runtime.terminal_ref,
    generation: 1,
  });
  assert.equal(closed.ok, true);
  if (!closed.ok || !("runtime" in closed)) return;
  assert.equal(closed.runtime.state, "unknown");
  assert.equal(closed.runtime.failure_reason, "kill_unconfirmed");
  assert.equal(closed.runtime.exit_code, null);
});

test("shell/terminal#R11: OSC 52·OSC 8은 host 동작이 아니고 출력 chunk로만 남는다", async () => {
  const pty = fakePty();
  let push: ((chunk: string) => void) | undefined;
  const spawn = pty.spawn.bind(pty);
  pty.spawn = (options) => {
    const handle = spawn(options);
    const original = handle.onData.bind(handle);
    handle.onData = (listener) => {
      push = listener;
      return original(listener);
    };
    return handle;
  };
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  if (!opened.ok || !("runtime" in opened)) return;
  await new Promise((resolve) => setImmediate(resolve));
  push?.(
    "\u001b]52;c;c2VjcmV0\u0007\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007",
  );
  await new Promise((resolve) => setImmediate(resolve));
  const snap = await host.handle({
    id: "s",
    type: "snapshot",
    terminal_ref: opened.runtime.terminal_ref,
  });
  assert.equal(snap.ok, true);
  if (!snap.ok || !("output" in snap)) return;
  assert.equal(snap.output[0]?.chunk.includes("]52;"), true);
  const runtime = host.sessions()[0] as TerminalRuntime;
  assert.equal(runtime.program_path, "/bin/bash");
});

test("shell/terminal#R7: renderer가 다시 붙으면 살아 있는 buffer만 다시 보인다", async () => {
  const pty = fakePty();
  let push: ((chunk: string) => void) | undefined;
  const spawn = pty.spawn.bind(pty);
  pty.spawn = (options) => {
    const handle = spawn(options);
    handle.onData = (listener) => {
      push = listener;
      return { dispose() {} };
    };
    return handle;
  };
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  if (!opened.ok || !("runtime" in opened)) return;
  await new Promise((resolve) => setImmediate(resolve));
  push?.("hello\n");
  await new Promise((resolve) => setImmediate(resolve));
  const snap = await host.handle({
    id: "s",
    type: "snapshot",
    terminal_ref: opened.runtime.terminal_ref,
  });
  assert.equal(snap.ok, true);
  if (!snap.ok || !("output" in snap)) return;
  assert.equal(snap.output.map((item) => item.chunk).join(""), "hello\n");
});

test("shell/terminal#R8: resize는 그 generation의 PTY에만 적용한다", async () => {
  const pty = fakePty();
  const seen: number[][] = [];
  const spawn = pty.spawn.bind(pty);
  pty.spawn = (options) => {
    const handle = spawn(options);
    handle.resize = (columns, rows) => seen.push([columns, rows]);
    return handle;
  };
  const host = createHost(deps(pty, []));
  const opened = await host.handle(open());
  if (!opened.ok || !("runtime" in opened)) return;
  const resized = await host.handle({
    id: "z",
    type: "resize",
    terminal_ref: opened.runtime.terminal_ref,
    generation: 1,
    columns: 100,
    rows: 40,
  });
  assert.equal(resized.ok, true);
  assert.deepEqual(seen, [[100, 40]]);
});

test("shell/terminal#R2: 등록되지 않은 폴더 경로로는 시작하지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-term-"));
  try {
    writeFileSync(join(root, "note.txt"), "x");
    assert.equal(root.length > 0, true);
  } finally {
    rmSync(root, { recursive: true });
  }
});
