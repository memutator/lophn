import assert from "node:assert/strict";
import { test } from "node:test";

import { openConnection, stopCore } from "./core.ts";

const env = (values: Record<string, string>) => ({
  get: (name: string) => values[name],
});

test("자격 없는 agent shell 안의 CLI는 core에 붙지도, core를 띄우지도, 멈추지도 않는다", async () => {
  const touched: string[] = [];
  const io = {
    env: env({ LOPHN_AGENT_SHELL: "1" }),
    dataRoot: "/data",
    platform: "linux" as const,
    platformRoot: "/platform",
    productVersion: "0.0.0",
    dial: (() => {
      touched.push("dial");
      throw new Error("dialed");
    }) as never,
    spawnDetached: (() => {
      touched.push("spawn");
      throw new Error("spawned");
    }) as never,
  };
  const opened = await openConnection(io);
  assert.equal(opened.ok, false);
  assert.equal(!opened.ok && opened.error.code, "forbidden");
  const stopped = await stopCore(io);
  assert.equal(!stopped.ok && stopped.error.code, "forbidden");
  assert.deepStrictEqual(touched, []);
});
