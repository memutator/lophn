import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { createGuiCommand } from "./gui.ts";

// 저장소 실행은 LOPHN_HOME이 없거나 사람의 ~/.lophn이면 앱을 띄우지 않는다: 설치본 창이 뜨거나 개발 code가 실제 data root로 뜬다.
test("저장소 실행의 gui는 LOPHN_HOME이 없거나 <home>/.lophn이면 앱을 띄우지 않는다", async () => {
  let launched = 0;
  const gui = createGuiCommand(() => {
    launched += 1;
    return Promise.resolve(ok(undefined));
  }, true);
  const run = (LOPHN_HOME?: string) =>
    gui.run(
      { harness: "claude" },
      {
        cwd: "/w",
        home: "/home/p",
        env: {
          get: (name) => (name === "LOPHN_HOME" ? LOPHN_HOME : undefined),
        },
      },
    );
  for (const root of [undefined, "", "/home/p/.lophn", "/home/p/.lophn/"]) {
    const ran = await run(root);
    assert.equal(ran.ok ? "ok" : ran.error.code, "invalid_input");
  }
  assert.equal(launched, 0);
  assert.equal((await run("/repo/.dev-data")).ok, true);
  assert.equal(launched, 1);
});
