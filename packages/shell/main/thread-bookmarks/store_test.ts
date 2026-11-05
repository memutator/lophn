import assert from "node:assert/strict";
import { test } from "node:test";

import type { StoreDeps } from "../workspace/atomic-file.ts";
import { createThreadBookmarkStore } from "./store.ts";

// 파일 하나짜리 메모리 fs. 읽기가 한 틈 늦어서 줄 세우지 않은 두 쓰기는 서로 덮어쓴다.
function memoryFs(initial?: string) {
  const files = new Map<string, string>();
  const pending = new Map<string, string>();
  let path = "";
  const fs: Partial<StoreDeps> = {
    async readFile(file) {
      path = file;
      await new Promise((resolve) => setTimeout(resolve, 1));
      const content = files.get(file) ?? initial;
      if (content === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return new TextEncoder().encode(content);
    },
    mkdir: async () => undefined,
    unlink: async () => {},
    chmod: async () => {},
    async open(file) {
      return {
        async writeFile(data) {
          pending.set(file, data);
        },
        async chmod() {},
        async close() {},
      };
    },
    async rename(from, to) {
      files.set(to, pending.get(from) ?? "");
      pending.delete(from);
    },
  };
  return { fs, content: () => files.get(path) ?? initial };
}

const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" };

test("깨진 thread-bookmarks.json은 set이 덮어쓰지 못하고 내용이 그대로다", async () => {
  const corrupt: Record<string, string> = {
    "JSON이 아님": "{not json",
    "schema가 틀림": JSON.stringify({ ses_a: [{ message: 1 }] }),
    "모르는 field": JSON.stringify({
      ses_a: [{ message: "m", at: "t", x: 1 }],
    }),
  };
  for (const [name, content] of Object.entries(corrupt)) {
    const memory = memoryFs(content);
    const store = createThreadBookmarkStore("/data", { clock, fs: memory.fs });
    assert.deepEqual(
      await store.list("ses_a"),
      { ok: false, reason: "corrupt" },
      name,
    );
    assert.deepEqual(
      await store.set("ses_a", "m", true),
      { ok: false, reason: "corrupt" },
      name,
    );
    assert.equal(memory.content(), content, name);
  }
});

test("한 session의 bookmark를 켜고 꺼도 다른 session의 것은 남는다", async () => {
  const memory = memoryFs();
  const store = createThreadBookmarkStore("/data", { clock, fs: memory.fs });
  await store.set("ses_a", "m1", true);
  await store.set("claude:cli1", "o1", true);
  await store.set("ses_a", "m1", false);
  assert.deepEqual(await store.list("ses_a"), { ok: true, value: [] });
  assert.deepEqual(await store.list("claude:cli1"), {
    ok: true,
    value: ["o1"],
  });
  // 빈 session은 key를 지운다.
  assert.deepEqual(Object.keys(JSON.parse(memory.content()!)), ["claude:cli1"]);
});

test("같이 부른 set 둘이 둘 다 남는다", async () => {
  const store = createThreadBookmarkStore("/data", {
    clock,
    fs: memoryFs().fs,
  });
  await Promise.all([
    store.set("ses_a", "m1", true),
    store.set("ses_b", "m2", true),
  ]);
  assert.deepEqual(await store.list("ses_a"), { ok: true, value: ["m1"] });
  assert.deepEqual(await store.list("ses_b"), { ok: true, value: ["m2"] });
});
