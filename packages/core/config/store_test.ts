import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";
import { createSettingsRegistry } from "./registry.ts";
import { createSettingsStore } from "./store.ts";

const registry = createSettingsRegistry([
  declareSetting({
    key: "t.theme",
    type: z.enum(["light", "dark"]),
    default: "light",
  }),
  declareSetting({ key: "t.flag", type: z.boolean(), default: true }),
  declareSetting({ key: "t.count", type: z.number().int().min(1).max(5) }),
]);

async function withStore(
  run: (
    store: ReturnType<typeof createSettingsStore>,
    file: string,
    published: string[][],
  ) => void | Promise<void>,
  initial?: string,
) {
  const root = await mkdtemp(join(tmpdir(), "lophn-settings-"));
  if (initial !== undefined) writeFileSync(`${root}/settings.json`, initial);
  const published: string[][] = [];
  const store = createSettingsStore({
    root,
    registry,
    publish: (keys) => published.push(keys),
    log: () => {},
  });
  try {
    await run(store, `${root}/settings.json`, published);
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
}

test("틀린 설정 값은 이유와 함께 거절되고 파일은 그대로다", async () => {
  await withStore((store, file, published) => {
    const first = store.update([
      {
        key: "t.flag",
        action: "set",
        value: false,
      },
    ]);
    assert.ok(first.ok);
    assert.deepStrictEqual(first.value, { changed: ["t.flag"], rejected: [] });
    assert.deepStrictEqual(published, [["t.flag"]]);
    // Windows stat mode는 ACL을 나타내지 못한다.
    if (process.platform !== "win32") {
      assert.deepStrictEqual((statSync(file).mode ?? 0) & 0o777, 0o600);
    }
    const before = readFileSync(file);

    const secret = "do-not-echo-this-value";
    const cases = [
      [{ key: "t.nope", action: "set", value: secret }, "unknown_key"],
      [{ key: "t.flag", action: "set", value: secret }, "wrong_type"],
      [{ key: "t.count", action: "set", value: 9 }, "out_of_range"],
      [{ key: "t.theme", action: "set", value: secret }, "out_of_range"],
    ] as const;
    for (const [change, reason] of cases) {
      const result = store.update([
        { key: "t.theme", action: "set", value: "dark" },
        change,
      ]);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.value, {
        changed: [],
        rejected: [{ key: change.key, reason }],
      });
      assert.ok(!JSON.stringify(result).includes(secret));
      assert.deepStrictEqual(readFileSync(file), before);
    }
    assert.deepStrictEqual(published.length, 1);

    // 같은 값의 set과 없는 key의 unset은 바꾼 것이 아니다.
    const same = store.update([
      { key: "t.flag", action: "set", value: false },
      { key: "t.theme", action: "unset" },
    ]);
    assert.ok(same.ok);
    assert.deepStrictEqual(same.value.changed, []);
    assert.deepStrictEqual(readFileSync(file), before);
  });
});

test("모르는 key와 틀린 값이 있어도 아는 setting은 적용되고 update가 그 key를 지우지 않는다", async () => {
  await withStore(
    (store, file) => {
      assert.deepStrictEqual(store.chosen(), { "t.theme": "dark" });
      const result = store.update([
        { key: "t.flag", action: "set", value: false },
      ]);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.changed, ["t.flag"]);
      assert.deepStrictEqual(JSON.parse(readFileSync(file, "utf8")), {
        "t.count": 99,
        "t.flag": false,
        "t.removed": "kept",
        "t.theme": "dark",
      });
    },
    JSON.stringify({ "t.theme": "dark", "t.count": 99, "t.removed": "kept" }),
  );
});

test("깨진 settings.json은 update가 덮지 않는다", async () => {
  await withStore((store, file) => {
    const result = store.update([
      { key: "t.flag", action: "set", value: false },
    ]);
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "unavailable");
    assert.strictEqual(readFileSync(file, "utf8"), '{"t.theme": ');
  }, '{"t.theme": ');
});

test("reload 없이 파일이 바뀐 뒤의 update는 손으로 고친 key를 지우지 않는다", async () => {
  await withStore(
    (store, file, published) => {
      writeFileSync(
        file,
        JSON.stringify({ "t.theme": "dark", "t.mcp": "hand" }),
      );
      const result = store.update([
        { key: "t.flag", action: "set", value: false },
      ]);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.changed, ["t.flag"]);
      assert.deepStrictEqual(JSON.parse(readFileSync(file, "utf8")), {
        "t.flag": false,
        "t.mcp": "hand",
        "t.theme": "dark",
      });
      assert.deepStrictEqual(store.chosen(), {
        "t.flag": false,
        "t.theme": "dark",
      });
      assert.deepStrictEqual(published, [["t.theme"], ["t.flag"]]);
    },
    JSON.stringify({ "t.theme": "light" }),
  );
});
