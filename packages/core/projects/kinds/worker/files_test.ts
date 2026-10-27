import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openProjectFiles } from "./files.ts";

test("project 폴더 밖을 가리키는 symlink는 paths와 read에 나오지 않고 .git은 건너뛴다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-kinds-files-"));
  try {
    const project = `${base}/project`;
    const outside = `${base}/outside`;
    await mkdir(`${project}/docs`, { recursive: true });
    await mkdir(`${project}/.git`);
    await mkdir(`${outside}/dir`, { recursive: true });
    await writeFile(`${project}/docs/a.md`, "inside");
    await writeFile(`${project}/.git/config.md`, "git");
    await writeFile(`${outside}/secret.md`, "secret");
    await writeFile(`${outside}/dir/b.md`, "secret");
    await symlink(`${outside}/secret.md`, `${project}/docs/link.md`);
    await symlink(`${outside}/dir`, `${project}/docs/linkdir`);
    await symlink(`${outside}/dir`, `${project}/linked`);

    const files = openProjectFiles([project], [{ path: "", recursive: true }]);
    assert.deepStrictEqual(files.paths(), ["docs/a.md"]);
    assert.deepStrictEqual(files.read("docs/a.md"), "inside");
    for (const path of [
      "docs/link.md",
      "docs/linkdir/b.md",
      "linked/b.md",
      ".git/config.md",
    ]) {
      assert.deepStrictEqual(files.read(path), null, path);
    }

    // 폴더 자체가 밖을 가리키면 그 폴더는 보지 않는다.
    const linked = openProjectFiles(
      [project],
      [
        {
          path: "linked",
          recursive: true,
        },
      ],
    );
    assert.deepStrictEqual(linked.paths(), []);
  } finally {
    await rm(base, { recursive: true });
  }
});
