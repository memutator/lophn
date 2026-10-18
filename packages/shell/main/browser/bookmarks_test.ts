import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createBookmarkStore } from "./bookmarks.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-bookmarks-"));
  let n = 0;
  const store = createBookmarkStore(root, {
    ids: { bookmark: () => `b${++n}` },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
  });
  const file = join(root, "shell", "bookmarks.json");
  await mkdir(join(root, "shell"), { recursive: true });
  return { root, store, file };
}

const goodItem = {
  id: "x",
  title: "t",
  url: "https://a.example/",
  created_at: "2026-01-01T00:00:00.000Z",
};

test("깨진 bookmarks.json은 어떤 쓰기도 덮어쓰지 못하고 byte가 그대로다", async () => {
  const corrupt: Record<string, string> = {
    "JSON이 아님": "{not json",
    "schema가 틀림": JSON.stringify({ version: 1, bookmarks: [{ id: 1 }] }),
    "version이 다름": JSON.stringify({ version: 2, bookmarks: [] }),
    "모르는 field": JSON.stringify({ version: 1, bookmarks: [], extra: 1 }),
  };
  for (const [name, content] of Object.entries(corrupt)) {
    const { root, store, file } = await setup();
    try {
      await writeFile(file, content);
      assert.deepEqual(await store.list(), {
        ok: true,
        value: { state: "corrupt" },
      }, name);
      const results = [
        await store.add({ title: "t", url: "https://b.example/" }),
        await store.update({ id: "x", title: "u" }),
        await store.remove("x"),
      ];
      for (const r of results) {
        assert.deepEqual(r, { ok: false, reason: "corrupt" }, name);
      }
      assert.equal(await readFile(file, "utf8"), content, name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("정상 파일에 add한 항목을 list가 돌려주고 동시 쓰기가 섞이지 않는다", async () => {
  const { root, store, file } = await setup();
  try {
    await writeFile(
      file,
      JSON.stringify({ version: 1, bookmarks: [goodItem] }),
    );
    const [a, b] = await Promise.all([
      store.add({ title: " 하나 ", url: "https://b.example/#f" }),
      store.add({ title: "둘", url: "https://c.example/" }),
    ]);
    assert.equal(a.ok && b.ok, true);
    const listed = await store.list();
    assert.equal(listed.ok && listed.value.state, "ok");
    if (listed.ok && listed.value.state === "ok") {
      assert.deepEqual(listed.value.bookmarks.map((x) => x.title), [
        "t",
        "하나",
        "둘",
      ]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
