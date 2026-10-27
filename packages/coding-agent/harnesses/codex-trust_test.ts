import assert from "node:assert/strict";
import { test } from "node:test";

import { codexHookHash } from "./codex-trust.ts";

// Codex rust-v0.164.0의 core/tests/suite/hooks.rs가 config.toml에 둔 plugin hook의 declaration hash다.
// 우리 hash가 틀리면 Codex가 trust를 인정하지 않고 hook을 계속 건너뛴다.
test("codex hook hash는 Codex 자신의 test가 쓰는 hash와 같다", async () => {
  const group = { matcher: "^Bash$" };
  const handler = {
    command: "python3 -I -S ${PLUGIN_ROOT}/hooks/pre_tool_use_hook.py",
  };
  assert.deepStrictEqual(
    [
      await codexHookHash("PreToolUse", group, handler),
      await codexHookHash("PostToolUse", group, handler),
    ],
    [
      "sha256:c9ee1aca1b5d8c72b99df6571c87d61350b09f7f4594ae30e7250a2027e9d76b",
      "sha256:9eef43ad6f26b1f9b94f318a50445f8bb62c363da08152a2966b73d308bf42ba",
    ],
  );
});
