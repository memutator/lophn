import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { folderOfCwd } from "./cwd.ts";

// 터미널은 등록 폴더 밖에서 열리면 안 된다. 하위 폴더는 받고, `..`와 밖으로 나가는 symlink는 거절한다.
test("시작 폴더는 등록 폴더 안만 받는다", () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-cwd-"));
  const outside = mkdtempSync(join(tmpdir(), "lophn-cwd-"));
  try {
    mkdirSync(join(root, "docs"));
    // junction은 Windows에서 권한 없이 만들어진다. POSIX는 type을 무시한다.
    symlinkSync(outside, join(root, "escape"), "junction");
    const folders = [{ folder_ref: "prj_0", path: root }];

    assert.deepStrictEqual(folderOfCwd(folders, root), {
      ok: true,
      folder_ref: "prj_0",
      path: root,
    });
    assert.deepStrictEqual(folderOfCwd(folders, join(root, "docs")), {
      ok: true,
      folder_ref: "prj_0",
      path: join(root, "docs"),
    });
    for (const cwd of [
      outside,
      join(root, "escape"),
      join(root, "docs", "..", ".."),
      join(root, "missing"),
    ]) {
      assert.deepStrictEqual(folderOfCwd(folders, cwd), { ok: false }, cwd);
    }
  } finally {
    rmSync(root, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});
