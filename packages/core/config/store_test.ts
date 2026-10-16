import { z } from "zod";
import { assert, assertEquals } from "@std/assert";
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
  const root = await Deno.makeTempDir();
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
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("틀린 설정 값은 이유와 함께 거절되고 파일은 그대로다", async () => {
  await withStore((store, file, published) => {
    const first = store.update([{
      key: "t.flag",
      action: "set",
      value: false,
    }]);
    assert(first.ok);
    assertEquals(first.value, { changed: ["t.flag"], rejected: [] });
    assertEquals(published, [["t.flag"]]);
    assertEquals((Deno.statSync(file).mode ?? 0) & 0o777, 0o600);
    const before = Deno.readFileSync(file);

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
      assert(result.ok);
      assertEquals(result.value, {
        changed: [],
        rejected: [{ key: change.key, reason }],
      });
      assert(!JSON.stringify(result).includes(secret));
      assertEquals(Deno.readFileSync(file), before);
    }
    assertEquals(published.length, 1);

    // 같은 값의 set과 없는 key의 unset은 바꾼 것이 아니다.
    const same = store.update([
      { key: "t.flag", action: "set", value: false },
      { key: "t.theme", action: "unset" },
    ]);
    assert(same.ok);
    assertEquals(same.value.changed, []);
    assertEquals(Deno.readFileSync(file), before);
  });
});
