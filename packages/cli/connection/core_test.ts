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

test("turn 자격 file이 비었을 때 GUI 탭의 CLI는 사람 자격으로 바꾸지 않고, 차 있으면 사람 자격을 받지 않는다", async () => {
  const touched: string[] = [];
  let file: string | null = null;
  const io = {
    env: env({ LOPHN_AGENT_CREDENTIAL_FILE: "/run/credentials/trm_1" }),
    dataRoot: "/data",
    platform: "linux" as const,
    platformRoot: "/platform",
    productVersion: "0.0.0",
    readCredential: () => file,
    dial: (async (request: string) => {
      touched.push(String(JSON.parse(request).type));
      return { ok: false, error: { code: "unavailable", message: "no core" } };
    }) as never,
    spawnDetached: (() => {
      touched.push("spawn");
      throw new Error("spawned");
    }) as never,
  };
  const outside = await openConnection(io);
  assert.equal(!outside.ok && outside.error.code, "unauthorized");
  const stopped = await stopCore(io);
  assert.equal(!stopped.ok && stopped.error.code, "forbidden");
  assert.deepStrictEqual(touched, []);
  // turn 안: 그 core를 찾기만 하고(identify) 사람 token을 받는 connect나 core 띄우기는 하지 않는다.
  file = "agent-token\n";
  await openConnection(io);
  assert.deepStrictEqual(touched, ["identify"]);
});
