import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seededRandom } from "../../../base/mod.ts";
import { GLOBAL_INSTRUCTIONS_MAX_BYTES } from "../../../protocol/lophn-agent/mod.ts";
import { createGlobalInstructionsHandlers } from "./global.ts";

test("전역 LOPHN.md 읽기·쓰기는 부재에서 시작해 base_hash가 맞을 때만 덮어쓰고 충돌 시 원본을 지킨다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-global-instructions-"));
  try {
    const handlers = createGlobalInstructionsHandlers(root, seededRandom(7));

    // 파일이 없으면 빈 글과 null hash다.
    const empty = await handlers.read();
    assert.ok(empty.ok);
    assert.deepEqual(empty.value, { text: "", hash: null });

    // 없는 파일에 null이 아닌 base_hash로 쓰면 conflict다.
    const badCreate = await handlers.write({
      text: "hello",
      base_hash: "a".repeat(64),
    });
    assert.equal(badCreate.ok, false);
    assert.equal(badCreate.error.code, "conflict");

    // base_hash: null로 처음 만든다.
    const created = await handlers.write({
      text: "be concise\n",
      base_hash: null,
    });
    assert.ok(created.ok);
    assert.equal(
      await readFile(join(root, "LOPHN.md"), "utf8"),
      "be concise\n",
    );

    const read1 = await handlers.read();
    assert.ok(read1.ok);
    assert.equal(read1.value.text, "be concise\n");
    assert.equal(read1.value.hash, created.value.hash);

    // 밖에서 바뀌면 옛 hash로 쓰기를 거절하고 디스크 내용을 지킨다.
    await writeFile(join(root, "LOPHN.md"), "edited elsewhere\n", "utf8");
    const stale = await handlers.write({
      text: "overwrite attempt\n",
      base_hash: created.value.hash,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict");
    assert.equal(
      await readFile(join(root, "LOPHN.md"), "utf8"),
      "edited elsewhere\n",
    );

    // 다시 읽은 hash로 쓰면 성공한다.
    const read2 = await handlers.read();
    assert.ok(read2.ok);
    const updated = await handlers.write({
      text: "updated\n",
      base_hash: read2.value.hash,
    });
    assert.ok(updated.ok);
    assert.equal(await readFile(join(root, "LOPHN.md"), "utf8"), "updated\n");

    // 상한 초과 글은 invalid_input으로 거절한다.
    const huge = await handlers.write({
      text: "x".repeat(GLOBAL_INSTRUCTIONS_MAX_BYTES + 1),
      base_hash: updated.value.hash,
    });
    assert.equal(huge.ok, false);
    assert.equal(huge.error.code, "invalid_input");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
