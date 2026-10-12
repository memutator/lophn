// documents/contexts#R20·R23 [ctx-T9b]: context worker의 파일 adapters. 임시 폴더에서 Project 파일 보기와
// check snapshot을 시험한다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { snapshotHash } from "../check/mod.ts";
import {
  cleanSnapshots,
  createSnapshotPort,
  openProjectFiles,
} from "./files.ts";

async function project(files: Record<string, string>): Promise<string> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-files-" }),
  );
  for (const [path, text] of Object.entries(files)) {
    const target = `${root}/${path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(target, text);
  }
  return root;
}

const remove = (...paths: string[]) =>
  Promise.all(paths.map((path) => Deno.remove(path, { recursive: true })));

Deno.test("documents/contexts#R23 [ctx-T9b]: project files lists only the contract folders, flat or recursive, without .git", async () => {
  const root = await project({
    "docs/a.md": "a",
    "docs/deep/b.md": "b",
    "docs/deep/deeper/c.md": "c",
    "other/x.md": "x",
    ".git/config": "secret",
    "docs/.git/config": "nested secret",
    "top.md": "top",
  });
  try {
    const flat = openProjectFiles([root], [{ path: "docs", recursive: false }]);
    assertEquals(flat.paths(), ["docs/a.md"]);
    const deep = openProjectFiles([root], [{ path: "docs", recursive: true }]);
    assertEquals(deep.paths(), [
      "docs/a.md",
      "docs/deep/b.md",
      "docs/deep/deeper/c.md",
    ]);
    const all = openProjectFiles([root], [{ path: "", recursive: true }]);
    assertEquals(all.paths(), [
      "docs/a.md",
      "docs/deep/b.md",
      "docs/deep/deeper/c.md",
      "other/x.md",
      "top.md",
    ]);
    const top = openProjectFiles([root], [{ path: "", recursive: false }]);
    assertEquals(top.paths(), ["top.md"]);
  } finally {
    await remove(root);
  }
});

Deno.test("documents/contexts#R23 [ctx-T9b]: stat and read give size, mtime and text, and a missing file gives null", async () => {
  const root = await project({ "docs/a.md": "héllo" });
  try {
    const files = openProjectFiles([root], [{
      path: "docs",
      recursive: false,
    }]);
    const stat = files.stat("docs/a.md");
    assertEquals(stat?.size, new TextEncoder().encode("héllo").length);
    assert(Number.isInteger(stat?.mtime_ms));
    assertEquals(files.read("docs/a.md"), "héllo");
    assertEquals(files.stat("docs/none.md"), null);
    assertEquals(files.read("docs/none.md"), null);
    // 폴더 밖 경로는 목록에 없으므로 읽지 않는다.
    assertEquals(files.read("../escape.md"), null);
  } finally {
    await remove(root);
  }
});

Deno.test("documents/contexts#R23 [ctx-T9b]: symlinks that leave the root are left out, ones inside the root are read, symlinked folders are not followed", async () => {
  const outside = await project({ "secret.md": "outside" });
  const root = await project({
    "docs/real.md": "real",
    "docs/sub/in.md": "in",
  });
  try {
    await Deno.symlink(`${outside}/secret.md`, `${root}/docs/leak.md`);
    await Deno.symlink(`${root}/docs/real.md`, `${root}/docs/alias.md`);
    await Deno.symlink(`${outside}`, `${root}/docs/outdir`);
    await Deno.symlink(`${root}/docs/sub`, `${root}/docs/subalias`);
    const files = openProjectFiles([root], [{ path: "docs", recursive: true }]);
    assertEquals(files.paths(), [
      "docs/alias.md",
      "docs/real.md",
      "docs/sub/in.md",
    ]);
    assertEquals(files.read("docs/alias.md"), "real");
    assertEquals(files.read("docs/leak.md"), null);
  } finally {
    await remove(root, outside);
  }
});

Deno.test("documents/contexts#R23 [ctx-T9b]: with several project folders the earlier folder wins a shared path", async () => {
  const first = await project({ "docs/a.md": "first", "docs/only1.md": "1" });
  const second = await project({ "docs/a.md": "second", "docs/only2.md": "2" });
  try {
    const files = openProjectFiles(
      [first, second],
      [{ path: "docs", recursive: false }],
    );
    assertEquals(files.paths(), [
      "docs/a.md",
      "docs/only1.md",
      "docs/only2.md",
    ]);
    assertEquals(files.read("docs/a.md"), "first");
    assertEquals(files.read("docs/only2.md"), "2");
  } finally {
    await remove(first, second);
  }
});

Deno.test("documents/contexts#R23 [ctx-T9b]: excluded folders such as lophn data are not walked", async () => {
  const root = await project({ "keep/a.md": "a", "data/derived/b.md": "b" });
  try {
    const files = openProjectFiles(
      [root],
      [{ path: "", recursive: true }],
      { exclude: [`${root}/data`] },
    );
    assertEquals(files.paths(), ["keep/a.md"]);
  } finally {
    await remove(root);
  }
});

Deno.test("documents/contexts#R23 [ctx-T9b]: a file over the size budget cannot be read, and too many files make the listing fail instead of being cut", async () => {
  const root = await project({
    "docs/big.md": "x".repeat(100),
    "docs/s.md": "s",
  });
  try {
    const files = openProjectFiles(
      [root],
      [{ path: "docs", recursive: false }],
      { limits: { fileBytes: 10 } },
    );
    assertEquals(files.read("docs/big.md"), null);
    assertEquals(files.read("docs/s.md"), "s");
    assertThrows(
      () =>
        openProjectFiles(
          [root],
          [{ path: "docs", recursive: false }],
          { limits: { files: 1 } },
        ),
      Error,
      "more than 1 files",
    );
  } finally {
    await remove(root);
  }
});

const CHECK = "chk_00000000000000000000000001";

Deno.test("documents/contexts#R20 [ctx-T9b]: a snapshot copies only the contract folders, reads from the copy, hashes like the source and is removed", async () => {
  const root = await project({
    "docs/a.md": "alpha",
    "docs/deep/b.md": "beta",
    "other/secret.md": "do not copy",
  });
  const staging = await Deno.makeTempDir({ prefix: "lophn-contexts-stage-" });
  try {
    const port = createSnapshotPort(staging);
    const made = port.create(CHECK, [{ path: "docs", recursive: true }], [
      root,
    ]);
    assert(made.ok, JSON.stringify(made));
    const snapshot = made.value;
    assertEquals(snapshot.files.paths(), ["docs/a.md", "docs/deep/b.md"]);
    assertEquals(snapshot.files.read("docs/deep/b.md"), "beta");
    assertEquals(
      (await Deno.stat(`${staging}/${CHECK}/docs/a.md`)).isFile,
      true,
    );
    await Deno.stat(`${staging}/${CHECK}/other`).then(
      () => assert(false, "files outside the contract must not be copied"),
      () => {},
    );

    // 원본을 바꿔도 snapshot은 고정이다.
    await Deno.writeTextFile(`${root}/docs/a.md`, "changed");
    assertEquals(snapshot.files.read("docs/a.md"), "alpha");
    const source = openProjectFiles([root], [{
      path: "docs",
      recursive: true,
    }]);
    await Deno.writeTextFile(`${root}/docs/a.md`, "alpha");
    assertEquals(snapshotHash(snapshot.files), snapshotHash(source));

    snapshot.remove();
    snapshot.remove();
    await Deno.stat(`${staging}/${CHECK}`).then(
      () => assert(false, "the snapshot folder must be gone"),
      () => {},
    );
  } finally {
    await remove(root, staging);
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a snapshot keeps an unreadable file listed so the hash tells it from an empty one", async () => {
  const root = await project({
    "docs/a.md": "ok",
    "docs/big.md": "x".repeat(50),
  });
  const staging = await Deno.makeTempDir({ prefix: "lophn-contexts-stage-" });
  try {
    const made = createSnapshotPort(staging, { limits: { fileBytes: 10 } })
      .create(CHECK, [{ path: "docs", recursive: false }], [root]);
    assert(made.ok);
    assertEquals(made.value.files.paths(), ["docs/a.md", "docs/big.md"]);
    assertEquals(made.value.files.read("docs/big.md"), null);
    made.value.remove();
  } finally {
    await remove(root, staging);
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a snapshot over the byte budget is unavailable and leaves no folder behind", async () => {
  const root = await project({
    "docs/a.md": "x".repeat(8),
    "docs/b.md": "y".repeat(8),
  });
  const staging = await Deno.makeTempDir({ prefix: "lophn-contexts-stage-" });
  try {
    const made = createSnapshotPort(staging, { limits: { snapshotBytes: 10 } })
      .create(CHECK, [{ path: "docs", recursive: false }], [root]);
    assert(!made.ok);
    assertEquals(made.error.code, "unavailable");
    assertEquals([...Deno.readDirSync(staging)], []);
  } finally {
    await remove(root, staging);
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a check id that is not a check id is refused before any folder is made", async () => {
  const staging = await Deno.makeTempDir({ prefix: "lophn-contexts-stage-" });
  try {
    const made = createSnapshotPort(staging).create(
      "../../etc",
      [{ path: "", recursive: true }],
      [],
    );
    assert(!made.ok);
    assertEquals(made.error.code, "invalid_input");
    assertEquals([...Deno.readDirSync(staging)], []);
  } finally {
    await remove(staging);
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: leftover snapshots from a process that died are cleared at start", async () => {
  const staging = await Deno.makeTempDir({ prefix: "lophn-contexts-stage-" });
  try {
    await Deno.mkdir(`${staging}/${CHECK}/docs`, { recursive: true });
    await Deno.writeTextFile(`${staging}/${CHECK}/docs/a.md`, "left");
    cleanSnapshots(staging);
    assertEquals([...Deno.readDirSync(staging)], []);
    // 폴더가 아직 없어도 던지지 않는다.
    cleanSnapshots(`${staging}/none`);
  } finally {
    await remove(staging);
  }
});
