import { assertEquals } from "@std/assert";
import { openProjectFiles } from "./files.ts";

Deno.test("project 폴더 밖을 가리키는 symlink는 paths와 read에 나오지 않고 .git은 건너뛴다", async () => {
  const base = await Deno.makeTempDir();
  try {
    const project = `${base}/project`;
    const outside = `${base}/outside`;
    await Deno.mkdir(`${project}/docs`, { recursive: true });
    await Deno.mkdir(`${project}/.git`);
    await Deno.mkdir(`${outside}/dir`, { recursive: true });
    await Deno.writeTextFile(`${project}/docs/a.md`, "inside");
    await Deno.writeTextFile(`${project}/.git/config.md`, "git");
    await Deno.writeTextFile(`${outside}/secret.md`, "secret");
    await Deno.writeTextFile(`${outside}/dir/b.md`, "secret");
    await Deno.symlink(`${outside}/secret.md`, `${project}/docs/link.md`);
    await Deno.symlink(`${outside}/dir`, `${project}/docs/linkdir`);
    await Deno.symlink(`${outside}/dir`, `${project}/linked`);

    const files = openProjectFiles([project], [{ path: "", recursive: true }]);
    assertEquals(files.paths(), ["docs/a.md"]);
    assertEquals(files.read("docs/a.md"), "inside");
    for (
      const path of [
        "docs/link.md",
        "docs/linkdir/b.md",
        "linked/b.md",
        ".git/config.md",
      ]
    ) {
      assertEquals(files.read(path), null, path);
    }

    // 폴더 자체가 밖을 가리키면 그 폴더는 보지 않는다.
    const linked = openProjectFiles([project], [{
      path: "linked",
      recursive: true,
    }]);
    assertEquals(linked.paths(), []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
