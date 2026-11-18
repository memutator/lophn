import assert from "node:assert/strict";
import { test } from "node:test";

import { childCliRunner } from "./coding-connection.ts";

test("`lophn --json`의 성공 출력은 그대로 data가 되고 `{error}` 출력은 실패가 된다", async () => {
  const run = (stdout: string) =>
    childCliRunner({
      command: "/bin/lophn",
      env: {},
      exec: () => Promise.resolve({ code: 0, stdout }),
    })(["harness", "detect"]);
  assert.deepEqual(await run('[{"id":"claude"}]\n'), {
    ok: true,
    data: [{ id: "claude" }],
  });
  assert.deepEqual(
    await run('{"error":{"code":"invalid_input","message":"x"}}\n'),
    { ok: false, message: "x" },
  );
});
