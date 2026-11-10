import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import {
  declareSetting,
  declareSettingFolder,
  type SettingIssue,
} from "../../protocol/config/mod.ts";
import { createSettingsRegistry } from "./registry.ts";
import { settingsUpdateHandler } from "./routes.ts";
import { createSettingsStore } from "./store.ts";

// 항목은 { tone }이고 `other`가 가리키는 항목이 있어야 한다. tone이 "loud"면 쓰되 알린다.
const notes = declareSettingFolder({
  key: "t.notes",
  folder: "notes",
  type: z.object({ tone: z.string(), other: z.string().optional() }),
  description: "t",
  check: (value, view): SettingIssue[] => [
    ...(value.other !== undefined && !(value.other in view.entries(notes))
      ? [{ level: "reject" as const, message: "other does not exist" }]
      : []),
    ...(value.tone === "loud"
      ? [{ level: "note" as const, message: "loud" }]
      : []),
  ],
});
const registry = createSettingsRegistry(
  [
    declareSetting({
      key: "t.theme",
      type: z.enum(["light", "dark"]),
      default: "light",
      description: "t",
    }),
    declareSetting({
      key: "t.flag",
      type: z.boolean(),
      default: true,
      description: "t",
    }),
    declareSetting({
      key: "t.count",
      type: z.number().int().min(1).max(5),
      description: "t",
    }),
    declareSetting({
      key: "t.rules",
      type: z.boolean(),
      default: false,
      description: "t",
      locked: true,
    }),
    // 고른 note가 있어야 한다.
    declareSetting({
      key: "t.pick",
      type: z.string(),
      default: "",
      description: "t",
      check: (value, view) =>
        value === "" || value in view.entries(notes)
          ? []
          : [{ level: "reject", message: "no such note" }],
    }),
  ],
  [notes],
);

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
    assert.deepStrictEqual(first.value, {
      changed: ["t.flag"],
      rejected: [],
      notes: [],
    });
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
        notes: [],
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

test("항목 file은 그 항목만 쓰고 지우며, 거절하면 아무 file도 바뀌지 않고 사람이 둔 읽지 못한 file을 덮지 않는다", async () => {
  await withStore((store, file, published) => {
    const dir = join(file, "..", "notes");
    // 사람이 손으로 둔 file. 읽지 못하는 것도 그대로 남아야 한다.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hand.json"), '{"tone":"soft"}');
    writeFileSync(join(dir, "Broken Name.json"), "{}");
    writeFileSync(join(dir, "torn.json"), '{"tone": ');
    writeFileSync(join(dir, "Mixed.json"), '{"tone":"soft"}');
    const names = () => readdirSync(dir).sort();

    // 손으로 둔 항목을 가리키는 새 항목과 그것을 고르는 설정을 한 번에 쓴다.
    const made = store.update([
      {
        key: "t.notes.mine",
        action: "set",
        value: { tone: "loud", other: "hand" },
      },
      { key: "t.pick", action: "set", value: "mine" },
    ]);
    assert.ok(made.ok);
    assert.deepStrictEqual(made.value, {
      changed: ["t.notes.mine", "t.pick"],
      rejected: [],
      notes: [{ key: "t.notes.mine", message: "loud" }],
    });
    assert.deepStrictEqual(
      JSON.parse(readFileSync(join(dir, "mine.json"), "utf8")),
      { tone: "loud", other: "hand" },
    );
    assert.deepStrictEqual(store.folder(notes), {
      values: { hand: { tone: "soft" }, mine: { tone: "loud", other: "hand" } },
      unreadable: [
        { name: "Broken Name", reason: "bad_id" },
        { name: "Mixed", reason: "bad_id" },
        { name: "torn", reason: "not_json" },
      ],
    });

    const before = names().map((name) => readFileSync(join(dir, name), "utf8"));
    const settings = readFileSync(file, "utf8");
    const refused = [
      // 없는 항목을 가리킨다.
      [
        {
          key: "t.notes.mine",
          action: "set",
          value: { tone: "a", other: "gone" },
        },
        "invalid_value",
      ],
      // 없는 항목을 고른다.
      [{ key: "t.pick", action: "set", value: "gone" }, "invalid_value"],
      [
        { key: "t.notes.mine", action: "set", value: { tone: 3 } },
        "wrong_type",
      ],
      [
        { key: "t.notes.Bad Id", action: "set", value: { tone: "a" } },
        "unknown_key",
      ],
      // 사람이 둔 file이 그 이름으로 있는데 읽지 못했다. 덮지 않는다.
      [
        { key: "t.notes.torn", action: "set", value: { tone: "a" } },
        "invalid_value",
      ],
      // 대소문자만 다른 이름의 file이 있다(같은 file일 수 있다).
      [
        { key: "t.notes.mixed", action: "set", value: { tone: "a" } },
        "invalid_value",
      ],
      [
        {
          key: "t.notes.big",
          action: "set",
          value: { tone: "x".repeat(300_000) },
        },
        "out_of_range",
      ],
    ] as const;
    for (const [change, reason] of refused) {
      const result = store.update([
        { key: "t.notes.extra", action: "set", value: { tone: "soft" } },
        change,
      ]);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.changed, []);
      assert.deepStrictEqual(result.value.rejected[0]?.reason, reason);
    }
    assert.deepStrictEqual(
      names().map((name) => readFileSync(join(dir, name), "utf8")),
      before,
    );
    assert.deepStrictEqual(readFileSync(file, "utf8"), settings);

    const removed = store.update([{ key: "t.notes.mine", action: "unset" }]);
    assert.ok(removed.ok);
    assert.deepStrictEqual(removed.value.changed, ["t.notes.mine"]);
    assert.deepStrictEqual(names(), [
      "Broken Name.json",
      "Mixed.json",
      "hand.json",
      "torn.json",
    ]);
    assert.ok(!existsSync(join(dir, "mine.json")));
    assert.deepStrictEqual(published.at(-1), ["t.notes.mine"]);
  });
});

test("agent는 사람만 바꾸는 설정을 바꾸지 못하고 같이 보낸 변경도 쓰이지 않는다", async () => {
  await withStore(async (store, file) => {
    const update = settingsUpdateHandler(store);
    const changes = [
      { key: "t.flag", action: "set", value: false },
      { key: "t.rules", action: "set", value: true },
    ];
    const asAgent = await update({ actor: "agent:agt_1" } as never, {
      changes,
    });
    assert.deepStrictEqual(asAgent, {
      ok: true,
      value: {
        changed: [],
        rejected: [{ key: "t.rules", reason: "locked" }],
        notes: [],
      },
    });
    assert.ok(!existsSync(file));
    assert.deepStrictEqual(store.chosen(), {});

    // 잠기지 않은 설정은 agent가 바꾼다. 사람은 잠긴 설정도 바꾼다.
    const free = await update({ actor: "agent:agt_1" } as never, {
      changes: [changes[0]],
    });
    assert.ok(free.ok);
    const asUser = await update({ actor: "user:usr_1" } as never, { changes });
    assert.ok(asUser.ok);
    assert.deepStrictEqual(store.chosen(), {
      "t.flag": false,
      "t.rules": true,
    });
  });
});
