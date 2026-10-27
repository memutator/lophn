import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
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
) {
  const root = await mkdtemp(join(tmpdir(), "lophn-settings-"));
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
    const first = store.update([{
      key: "t.flag",
      action: "set",
      value: false,
    }]);
    assert.ok(first.ok);
    assert.deepStrictEqual(first.value, { changed: ["t.flag"], rejected: [] });
    assert.deepStrictEqual(published, [["t.flag"]]);
    assert.deepStrictEqual((statSync(file).mode ?? 0) & 0o777, 0o600);
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
