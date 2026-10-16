import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createFileAdapter,
  type FileAdapterOptions,
  sha256,
} from "./file-adapter.ts";

async function setup(fs?: FileAdapterOptions["fs"]) {
  const dir = await mkdtemp(join(tmpdir(), "lophn-file-adapter-"));
  const adapter = createFileAdapter({
    dataRoot: join(dir, "root"),
    folders: () => Promise.resolve([dir]),
    notify: () => {},
    fs,
  });
  return {
    dir,
    adapter,
    done: () => rm(dir, { recursive: true, force: true }),
  };
}

const hashOf = (text: string) => sha256(new TextEncoder().encode(text));

test("write는 기대 hash가 디스크와 다르면 conflict이고 원본을 바꾸지 않는다", async () => {
  const { dir, adapter, done } = await setup();
  try {
    const file = join(dir, "a.md");
    await writeFile(file, "disk");
    const cases: [string, string | null, string][] = [
      // 설명, 기대 hash, 쓰기 뒤 파일 내용
      ["같은 hash", hashOf("disk"), "new"],
      ["다른 hash", hashOf("other"), "disk"],
      ["null인데 파일이 있음", null, "disk"],
    ];
    for (const [label, base, after] of cases) {
      await writeFile(file, "disk");
      const reply = await adapter.write(1, {
        path: file,
        base_hash: base,
        text: "new",
      });
      assert.equal(reply.ok, after === "new", label);
      if (!reply.ok) assert.equal(reply.code, "conflict", label);
      else assert.equal(reply.value.hash, hashOf("new"), label);
      assert.equal(await readFile(file, "utf8"), after, label);
    }
    // 새 파일은 기대 hash가 null일 때만 만든다. 없는 파일에 hash를 기대하면 conflict다.
    const fresh = join(dir, "fresh.md");
    const missing = await adapter.write(1, {
      path: fresh,
      base_hash: hashOf("x"),
      text: "t",
    });
    assert.deepEqual(missing, { ok: false, code: "conflict" });
    const created = await adapter.write(1, {
      path: fresh,
      base_hash: null,
      text: "t",
    });
    assert.equal(created.ok, true);
    assert.equal(await readFile(fresh, "utf8"), "t");
  } finally {
    await done();
  }
});

test("쓰기가 끊겨도 원본이 남고 임시 파일은 치운다", async () => {
  for (const broken of ["writeTemp", "rename"] as const) {
    const { dir, adapter, done } = await setup(
      broken === "writeTemp"
        ? {
          writeTemp: async (path) => {
            await writeFile(path, "half");
            throw new Error("disk full");
          },
        }
        : { rename: () => Promise.reject(new Error("interrupted")) },
    );
    try {
      const file = join(dir, "a.md");
      await writeFile(file, "disk");
      const reply = await adapter.write(1, {
        path: file,
        base_hash: hashOf("disk"),
        text: "new",
      });
      assert.equal(reply.ok, false, broken);
      assert.equal(await readFile(file, "utf8"), "disk", broken);
      assert.deepEqual(await readdir(dir), ["a.md"], broken);
    } finally {
      await done();
    }
  }
});
