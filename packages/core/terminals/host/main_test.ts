import assert from "node:assert/strict";
import { test } from "node:test";
import { systemClock } from "../../../base/clock.ts";
import { createIdSource } from "../../../base/id.ts";
import { cryptoRandom } from "../../../base/random.ts";
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
