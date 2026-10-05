import { assert, assertEquals } from "@std/assert";
import { fileReadPort, fileScanPort, fileWatchPort } from "./fs.ts";
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

Deno.test("documents/file-tracking#R3: 실제 symlink가 형제 폴더를 가리키면 scan에 넣지 않는다", async () => {
  const parent = await Deno.makeTempDir({ prefix: "lophn-link-" });
  const root = `${parent}/proj`;
  const sibling = `${parent}/proj2`;
  try {
    await Deno.mkdir(root);
    await Deno.mkdir(sibling);
    await Deno.writeTextFile(`${root}/notes.md`, "in");
    await Deno.writeTextFile(`${sibling}/secret.md`, "out");
    await Deno.symlink(`${sibling}/secret.md`, `${root}/alias.md`);
    const scanned = await scanRoot(fileScanPort(), {
      root,
      patterns: [{ glob: "**/*", effect: "include" }],
      useGitignore: false,
      enabled: true,
    });
    assert(scanned.ok);
    assertEquals(scanned.value.map((file) => file.relative), ["notes.md"]);
  } finally {
    await Deno.remove(parent, { recursive: true });
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

Deno.test("documents/file-tracking#R3: 실제 watch는 파일 변경을 힌트로 내고 중단하면 열린 watcher를 닫는다", async () => {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-watch-" }),
  );
  try {
    const closing = new AbortController();
    const iterator = fileWatchPort().watch(root, closing.signal)
      [Symbol.asyncIterator]();
    // 첫 신호를 기다리는 동안 파일을 만든다.
    const first = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Deno.writeTextFile(`${root}/a.md`, "one");
    const hint = await first;
    assert(!hint.done);
    assertEquals(hint.value.kind, "changed");
    // 중단하면 기다리던 next가 끝나고 closed가 온다. 열린 채로 남지 않는다.
    const pending = iterator.next();
    closing.abort();
    let ended = false;
    for (let step = 0; step < 20 && !ended; step++) {
      const result = await Promise.race([
        pending.then((value) => value),
        new Promise<"waiting">((resolve) =>
          setTimeout(() => resolve("waiting"), 100)
        ),
      ]);
      if (result === "waiting") continue;
      ended = result.done === true || result.value.kind === "closed" ||
        result.value.kind === "changed";
    }
    assert(ended);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
