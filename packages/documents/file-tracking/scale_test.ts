import { assert, assertEquals } from "@std/assert";
import { fileScanPort } from "./fs.ts";
import { scanRoot } from "./work.ts";

const FILES = 3_000;

Deno.test("documents/file-tracking#R5: 파일 3000개 변경 중 다른 root의 작은 저장과 고정 판 읽기가 응답한다", async () => {
  const big = await Deno.makeTempDir({ prefix: "lophn-scale-big-" });
  const small = await Deno.makeTempDir({ prefix: "lophn-scale-small-" });
  try {
    for (let index = 0; index < FILES; index++) {
      await Deno.writeTextFile(`${big}/file-${index}.md`, `body ${index}`);
    }
    await Deno.writeTextFile(`${small}/note.md`, "small");

    // 큰 root scan을 먼저 시작하고 끝나기를 기다리지 않는다.
    const scanning = scanRoot(fileScanPort(), {
      root: big,
      patterns: [{ glob: "**/*.md", effect: "include" }],
      useGitignore: false,
      enabled: true,
    });

    // 다른 root의 작은 저장(한 파일 읽기)과 고정 판 읽기는 큰 scan과 별개로 응답한다.
    const saved = await Deno.readTextFile(`${small}/note.md`);
    const fixed = await Deno.readTextFile(`${small}/note.md`);
    assertEquals(saved, "small");
    assertEquals(fixed, "small");

    const scanned = await scanning;
    assert(scanned.ok);
    assertEquals(scanned.value.length, FILES);
  } finally {
    await Deno.remove(big, { recursive: true });
    await Deno.remove(small, { recursive: true });
  }
});
