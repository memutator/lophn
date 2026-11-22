import assert from "node:assert/strict";
import { test } from "node:test";
import { systemClock } from "../../../base/clock.ts";
import { createIdSource } from "../../../base/id.ts";
import { cryptoRandom } from "../../../base/random.ts";
import { harnessOfProcess } from "../../../protocol/coding-agent/mod.ts";
import { parseWindowsCommandLine, selectWinForeground } from "./foreground.ts";
import { hostFromNodePty } from "./main.ts";
import type { PtyAdapter, PtyHandle } from "./pty.ts";
import type { HostReply } from "./wire.ts";

// PTY fd가 막 닫히고 node-pty exit가 오기 전에 resize가 던지면 host process가 끝나 모든 탭이 unknown이 됐다.
test("PTY 하나의 resize가 던져도 그 요청만 host_lost로 답하고 다른 터미널은 계속 ok다", async () => {
  let pid = 100;
  const written: string[] = [];
  const pty: PtyAdapter = {
    spawn() {
      const bad = pid === 100;
      const handle: PtyHandle = {
        pid: pid++,
        write: (data) => void written.push(data),
        resize() {
          if (bad) throw new Error("ioctl(2) failed, EBADF");
        },
        kill() {},
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        foreground: () => null,
      };
      return handle;
    },
    group: (groupPid) => ({
      pid: groupPid,
      kill: () => ({ confirmed: true }),
      alive: () => false,
    }),
  };
  const host = hostFromNodePty({
    pty,
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    env: { SHELL: "/bin/sh" },
    platform: "linux",
    exists: () => true,
    checkFolder: (path) => ({ ok: true, path }),
    schedule: (done) => setImmediate(done),
    sleep: async () => {},
  });
  const open = async () => {
    const reply = (await host.handle({
      type: "open",
      project: "prj",
      folders: [{ folder_ref: "fld", path: "/tmp" }],
      columns: 80,
      rows: 24,
    })) as Extract<HostReply, { ok: true }>;
    return reply.runtime;
  };
  const first = await open();
  const second = await open();
  const target = (runtime: typeof first) => ({
    terminal_ref: runtime.terminal_ref,
    generation: runtime.generation,
  });

  const lost = await host.handle({
    type: "resize",
    ...target(first),
    columns: 100,
    rows: 30,
  });
  assert.equal(lost.ok, false);
  assert.equal(!lost.ok && lost.reason, "host_lost");

  const input = await host.handle({
    type: "input",
    ...target(second),
    text: "ls\n",
  });
  const resize = await host.handle({
    type: "resize",
    ...target(second),
    columns: 100,
    rows: 30,
  });
  assert.equal(input.ok, true);
  assert.equal(resize.ok, true);
  assert.deepEqual(written, ["ls\n"]);
  await host.shutdown();
});

test("Windows foreground 선택은 자손 tree에서 가장 얕은 harness를 고르고 exit 시 null로 정리한다", async () => {
  const isHarness = (argv: readonly string[]) =>
    harnessOfProcess(argv) !== null;

  assert.deepEqual(
    parseWindowsCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@qwen-code\\qwen-code\\cli.js" --resume "a b"',
    ),
    [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@qwen-code\\qwen-code\\cli.js",
      "--resume",
      "a b",
    ],
  );

  // claude.exe 아래에 bash.exe가 떠도 얕은 claude.exe가 먼저 잡힌다.
  const nested = selectWinForeground(
    [
      {
        pid: 20,
        ppid: 10,
        name: "claude.exe",
        commandLine: '"C:\\Users\\u\\.local\\bin\\claude.exe" --resume s1',
      },
      {
        pid: 30,
        ppid: 20,
        name: "bash.exe",
        commandLine: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "git status"',
      },
    ],
    isHarness,
  );
  assert.deepEqual(nested, [
    "C:\\Users\\u\\.local\\bin\\claude.exe",
    "--resume",
    "s1",
  ]);
  assert.equal(harnessOfProcess(nested!), "claude");

  // cmd.exe shim 아래의 node.exe qwen-code는 cmd.exe를 건너뛰고 잡힌다.
  const shimmed = selectWinForeground(
    [
      { pid: 21, ppid: 10, name: "cmd.exe", commandLine: "cmd.exe /c qwen" },
      {
        pid: 22,
        ppid: 21,
        name: "node.exe",
        commandLine:
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\@qwen-code\\qwen-code\\dist\\cli.js"',
      },
    ],
    isHarness,
  );
  assert.equal(harnessOfProcess(shimmed!), "qwen");

  // harness가 없으면 null이다.
  assert.equal(
    selectWinForeground(
      [{ pid: 25, ppid: 10, name: "git.exe", commandLine: "git status" }],
      isHarness,
    ),
    null,
  );

  let currentArgv: string[] | null = [
    "C:\\Users\\u\\AppData\\Local\\agy\\bin\\agy.exe",
  ];
  let stopped = false;
  const pty: PtyAdapter = {
    spawn() {
      return {
        pid: 500,
        write() {},
        resize() {},
        kill() {},
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        foreground: () => null,
      };
    },
    group: (groupPid) => ({
      pid: groupPid,
      kill: () => ({ confirmed: true }),
      alive: () => false,
    }),
  };
  const host = hostFromNodePty({
    pty,
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    env: { SystemRoot: "C:\\Windows" },
    platform: "win32",
    exists: () => true,
    checkFolder: (path) => ({ ok: true, path }),
    schedule: (done) => setImmediate(done),
    sleep: async () => {},
    winForeground: {
      query: async (pids) => new Map(pids.map((pid) => [pid, currentArgv])),
      stop() {
        stopped = true;
      },
    },
  });
  await host.handle({
    type: "open",
    project: "prj",
    folders: [{ folder_ref: "fld", path: "C:\\work" }],
    columns: 80,
    rows: 24,
  });

  const first = await host.foregroundChanges();
  assert.equal(first.length, 1);
  assert.deepEqual(first[0]!.argv, [
    "C:\\Users\\u\\AppData\\Local\\agy\\bin\\agy.exe",
  ]);
  // 변화가 없으면 빈 목록이다.
  assert.deepEqual(await host.foregroundChanges(), []);
  // TUI가 끝나면 null 변화가 한 번 나간다.
  currentArgv = null;
  const exited = await host.foregroundChanges();
  assert.equal(exited.length, 1);
  assert.equal(exited[0]!.argv, null);

  await host.shutdown();
  assert.equal(stopped, true);
});
