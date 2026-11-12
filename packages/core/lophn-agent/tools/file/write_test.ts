import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FileHooks } from "../ports.ts";
import type { ToolContext } from "../tool-context.ts";
import { fsFail } from "./scope.ts";
import { editFile, writeFile as writeTool } from "./write.ts";

const hooks: FileHooks = { aroundWrite: (_ctx, _target, run) => run() };

async function withDir(run: (dir: string, ctx: ToolContext) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "lophn-write-"));
  let n = 0;
  const ctx = {
    scope: { read: [dir], write: [dir] },
    ids: { newId: (prefix: string) => `${prefix}_${n++}` },
  } as unknown as ToolContext;
  try {
    await run(dir, ctx);
  } finally {
    await rm(dir, { recursive: true });
  }
}

const bytesOf = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string" ? Buffer.from(part) : Buffer.from(part),
    ),
  );

test("BOM과 CRLF가 있는 file을 LF old_string으로 edit하면 바꾼 곳 밖의 byte와 BOM·CRLF가 그대로다", async () => {
  await withDir(async (dir, ctx) => {
    const bom = [0xef, 0xbb, 0xbf];
    const file = join(dir, "a.txt");
    await writeFile(file, bytesOf(bom, "한글\r\nfoo\r\nbar\r\n"));
    await chmod(file, 0o640);
    const done = await editFile(
      { path: "a.txt", old_string: "foo\nbar", new_string: "x\ny\nz" },
      ctx,
      hooks,
    );
    assert.equal(done.ok, true);
    const next = await readFile(file);
    assert.deepStrictEqual(next, bytesOf(bom, "한글\r\nx\r\ny\r\nz\r\n"));
    assert.equal((await stat(file)).mode & 0o777, 0o640);
    assert.deepStrictEqual(
      done.ok && (done.value.content as { bytes: number }).bytes,
      next.length,
    );
    // temp file이 남지 않는다.
    assert.deepStrictEqual(await readdir(dir), ["a.txt"]);

    // file.write로 덮어도 BOM과 CRLF가 남는다. 이미 CRLF인 content는 그대로다.
    await writeTool({ path: "a.txt", content: "one\ntwo\n" }, ctx, hooks);
    assert.deepStrictEqual(
      await readFile(file),
      bytesOf(bom, "one\r\ntwo\r\n"),
    );
    await writeTool({ path: "a.txt", content: "a\r\nb\n" }, ctx, hooks);
    assert.deepStrictEqual(await readFile(file), bytesOf(bom, "a\r\nb\n"));
  });
});

test("UTF-8이 아닌 file은 file.edit가 거절하고 byte가 바뀌지 않는다", async () => {
  await withDir(async (dir, ctx) => {
    // CP949 "한글"과 NUL이 든 file.
    const cases: [string, Buffer][] = [
      ["cp949", bytesOf([0xc7, 0xd1, 0xb1, 0xdb], " foo")],
      ["nul", bytesOf("foo", [0], "bar")],
    ];
    for (const [name, content] of cases) {
      const file = join(dir, name);
      await writeFile(file, content);
      const done = await editFile(
        { path: name, old_string: "foo", new_string: "bar" },
        ctx,
        hooks,
      );
      assert.equal(done.ok, false, name);
      if (!done.ok) assert.equal(done.error.code, "invalid_input", name);
      assert.deepStrictEqual(await readFile(file), content, name);
    }

    // file.write는 통째로 바꾼다.
    await writeTool({ path: "cp949", content: "new" }, ctx, hooks);
    assert.equal(await readFile(join(dir, "cp949"), "utf8"), "new");
  });
});

test("쓰기가 실패하면 원래 file이 그대로이고 temp가 남지 않으며, 상한을 넘는 쓰기는 거절한다", async () => {
  await withDir(async (dir, ctx) => {
    await writeFile(join(dir, "keep.txt"), "original");
    // 폴더 위에 file을 쓰면 rename이 실패한다.
    await mkdir(join(dir, "folder"));
    const onDir = await writeTool({ path: "folder", content: "x" }, ctx, hooks);
    assert.equal(onDir.ok, false);
    assert.deepStrictEqual((await readdir(dir)).sort(), ["folder", "keep.txt"]);

    const big = await writeTool(
      { path: "keep.txt", content: "a".repeat(10 * 1024 * 1024 + 1) },
      ctx,
      hooks,
    );
    assert.equal(big.ok, false);
    if (!big.ok) assert.equal(big.error.code, "invalid_input");
    assert.equal(await readFile(join(dir, "keep.txt"), "utf8"), "original");
  });

  const errno = (code: string) => fsFail(Object.assign(new Error(), { code }));
  const cases: [string, string, string][] = [
    ["EACCES", "invalid_input", "permission denied"],
    ["ENOSPC", "invalid_input", "no space left on the disk"],
    ["ENOENT", "not_found", "file not found"],
    ["EXYZ", "invalid_input", "cannot access this path"],
  ];
  for (const [code, kind, message] of cases) {
    const failed = errno(code);
    assert.equal(!failed.ok && failed.error.code, kind, code);
    assert.equal(!failed.ok && failed.error.message, message, code);
  }
});
