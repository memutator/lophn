import assert from "node:assert/strict";
import { test } from "node:test";

import { signalTree, type TreeDeps } from "./tree.ts";

function fake(options: { killError?: string; taskkillCode?: number }) {
  const calls: unknown[][] = [];
  const deps: TreeDeps = {
    kill: (pid, signal) => {
      calls.push(["kill", pid, signal]);
      if (options.killError) {
        throw Object.assign(new Error("kill"), { code: options.killError });
      }
    },
    run: async (command, args) => {
      calls.push(["run", command, ...args]);
      return { code: options.taskkillCode ?? 0 };
    },
  };
  return { deps, calls };
}

test("signalTree sends to the process group on POSIX and counts ESRCH as absent", async () => {
  const sent = fake({});
  assert.equal(await signalTree(42, "SIGTERM", "linux", sent.deps), "ok");
  assert.deepEqual(sent.calls, [["kill", -42, "SIGTERM"]]);
  assert.equal(
    await signalTree(
      42,
      "SIGKILL",
      "darwin",
      fake({ killError: "ESRCH" }).deps,
    ),
    "absent",
  );
  assert.equal(
    await signalTree(42, "SIGKILL", "linux", fake({ killError: "EPERM" }).deps),
    "failed",
  );
  assert.equal(await signalTree(1, "SIGKILL", "linux", sent.deps), "failed");
});

test("signalTree runs taskkill on win32 and counts code 128 as absent", async () => {
  const ran = fake({});
  assert.equal(await signalTree(42, "SIGTERM", "win32", ran.deps), "ok");
  assert.deepEqual(ran.calls, [["run", "taskkill", "/PID", "42", "/T", "/F"]]);
  assert.equal(
    await signalTree(42, "SIGKILL", "win32", fake({ taskkillCode: 128 }).deps),
    "absent",
  );
  assert.equal(
    await signalTree(42, "SIGKILL", "win32", fake({ taskkillCode: 1 }).deps),
    "failed",
  );
});
