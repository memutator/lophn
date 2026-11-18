import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { lophnCliPath } from "./person-env.ts";

// 설치된 앱의 터미널에서 띄운 저장소 core가 물려받은 `LOPHN_CLI`(설치된 CLI)를 쓰면 dev data root에 설치본 core가 떴다.
// 규칙은 env를 받지 않으므로 저장소 실행의 답은 저장소의 dev launcher이거나 null뿐이다.
test("저장소 실행은 저장소의 dev launcher만 쓰고 없으면 null이다", () => {
  const root = "/repo";
  const launcher = join(root, ".cache", "dev-cli", "lophn");
  const pick = (exists: boolean) =>
    lophnCliPath({
      installed: false,
      platformRoot: root,
      platform: "linux",
      exists: (path) => exists && path === launcher,
    });

  assert.equal(pick(true), launcher);
  assert.equal(pick(false), null);
});
