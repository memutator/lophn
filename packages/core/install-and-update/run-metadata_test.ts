import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeUserToken } from "./run-metadata.ts";

test("user token file은 token 원문만 담고 소유자만 읽고 쓴다(0600)", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "lophn-run-metadata-"));
  try {
    // 앞 core가 넓은 mode로 남긴 file의 mode가 이어지면 안 된다.
    await writeFile(`${runDir}/user-token`, "old", { mode: 0o644 });
    await chmod(`${runDir}/user-token`, 0o644);
    const written = await writeUserToken(runDir, "tok-abc");
    assert.deepStrictEqual(written.ok, true);
    const info = await stat(`${runDir}/user-token`);
    if (process.platform !== "win32") {
      assert.deepStrictEqual((info.mode ?? 0) & 0o777, 0o600);
    }
    assert.deepStrictEqual(
      await readFile(`${runDir}/user-token`, "utf8"),
      "tok-abc",
    );
  } finally {
    await rm(runDir, { recursive: true });
  }
});
