import assert from "node:assert/strict";
import { test } from "node:test";

import { posixGroup, spawnGrouped } from "../../terminal-host/child-group.ts";

test("shell/terminal#R10: process group을 끝내면 자식이 없고 확인 실패는 성공으로 말하지 않는다", async () => {
  const started = spawnGrouped(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } },
  );
  assert.equal(started.group.alive(), true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const signaled = started.group.kill("SIGKILL");
  assert.equal(signaled.confirmed, false);
  if (!signaled.confirmed) assert.equal(signaled.reason, "still_alive");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const confirmed = started.group.kill("SIGKILL");
  assert.equal(confirmed.confirmed, true);
  assert.equal(started.group.alive(), false);

  const missing = posixGroup(2_147_483_000);
  const probe = missing.kill("SIGTERM");
  assert.equal(probe.confirmed, true);
  assert.equal(missing.alive(), false);
});

test("shell/terminal#R5: 제어 pipe fd는 child env로 넘기지 않는다", () => {
  const started = spawnGrouped(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "" },
  });
  const keys = Object.keys(started.child.spawnargs ? {} : {});
  assert.equal(keys.includes("LOPHN_TERMINAL_CONTROL"), false);
  started.group.kill("SIGKILL");
});
