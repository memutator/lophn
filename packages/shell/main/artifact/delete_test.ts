import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { deleteArtifactFolder } from "./delete.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-delete-"));
  const artifacts = join(root, "artifacts");
  await mkdir(artifacts);
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep");
  return { root, artifacts, outside };
}

test("지우기는 그 artifact 폴더만 지우고 symlink는 따라가지 않는다", async () => {
  const { root, artifacts, outside } = await setup();
  try {
    await mkdir(join(artifacts, "mine"));
    await writeFile(join(artifacts, "mine", "index.html"), "x");
    // 폴더 안 symlink는 link만 지워지고 가리키는 밖 file은 남는다.
    await symlink(join(outside, "keep.txt"), join(artifacts, "mine", "link"));
    await symlink(outside, join(artifacts, "mine", "dir-link"), "junction");
    await mkdir(join(artifacts, "other"));
    await writeFile(join(artifacts, "other", "index.html"), "y");
    // symlink 폴더는 거절하고 가리키는 밖 폴더는 그대로다.
    await symlink(outside, join(artifacts, "escape"), "junction");

    assert.deepEqual(await deleteArtifactFolder(artifacts, "mine"), {
      ok: true,
      value: null,
    });
    await assert.rejects(stat(join(artifacts, "mine")));
    assert.equal(
      await readFile(join(artifacts, "other", "index.html"), "utf8"),
      "y",
    );
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");

    const escaped = await deleteArtifactFolder(artifacts, "escape");
    assert.equal(!escaped.ok && escaped.error.code, "forbidden");
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");

    const missing = await deleteArtifactFolder(artifacts, "nothing");
    assert.equal(!missing.ok && missing.error.code, "not_found");
    const bad = await deleteArtifactFolder(artifacts, "../outside");
    assert.equal(!bad.ok && bad.error.code, "invalid_input");
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
