import assert from "node:assert/strict";
import { test } from "node:test";

import { coreLaunch } from "./supervise.ts";

// core가 Deno flag로 돌아가면 설치본에서 core가 아예 뜨지 않는다. argv와 env를 고정한다.
test("core는 Electron의 Node로 뜨고 Deno는 앱과 flow에만 넘긴다", () => {
  const launch = coreLaunch({
    repoRoot: "/repo",
    dataRoot: "/data",
    denoBinary: "/opt/lophn/deno",
    packaged: true,
    env: { DENO_DIR: "/cache/deno" },
  });
  assert.equal(launch.command, process.execPath);
  assert.deepStrictEqual(launch.args, [
    "/repo/packages/core/main/daemon/main.ts",
    "--port=0",
  ]);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(launch.env.LOPHN_HOME, "/data");
  assert.equal(launch.env.LOPHN_DENO, "/opt/lophn/deno");
  assert.equal(launch.env.DENO_DIR, "/cache/deno");
});

test("core는 준다면 그 port로 뜬다", () => {
  const launch = coreLaunch({
    repoRoot: "/repo",
    dataRoot: "/data",
    denoBinary: "deno",
    packaged: false,
    port: 8123,
  });
  assert.deepStrictEqual(launch.args, [
    "/repo/packages/core/main/daemon/main.ts",
    "--port=8123",
  ]);
});
