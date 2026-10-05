import { assert, assertEquals } from "@std/assert";
import { fileReadPort, fileScanPort } from "./fs.ts";
import { readStably, scanRoot } from "./work.ts";

Deno.test("documents/file-tracking#R3: 임시 폴더 scan은 규칙에 맞는 파일만 읽고 .git은 내려가지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-scan-" });
  try {
    await Deno.mkdir(`${root}/.git`);
    await Deno.writeTextFile(`${root}/.git/config`, "secret");
    await Deno.writeTextFile(`${root}/notes.md`, "hello");
    await Deno.writeTextFile(`${root}/skip.txt`, "no");
    const scanned = await scanRoot(fileScanPort(), {
      root,
      patterns: [{ glob: "**/*.md", effect: "include" }],
      useGitignore: false,
      enabled: true,
    });
    assert(scanned.ok);
    assertEquals(scanned.value.map((file) => file.relative), ["notes.md"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R6: 임시 파일의 안정 읽기는 그 바이트의 hash를 낸다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-read-" });
  const path = `${root}/notes.md`;
  try {
    await Deno.writeTextFile(path, "hello");
    const read = await readStably(fileReadPort(), path);
    assert(read.ok);
    if (read.value.kind !== "stable") throw new Error("expected stable");
    assertEquals(read.value.read.bytes, new TextEncoder().encode("hello"));
    assertEquals(read.value.read.hash.length, 64);
    assertEquals(read.value.read.identity.realPath, await Deno.realPath(path));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
