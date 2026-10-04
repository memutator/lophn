import { assert, assertEquals } from "@std/assert";
import { defineBlueprint } from "./define.ts";
import { blueprint, command, secretPermission } from "./fixture.ts";
import { sameVerdict } from "./judge.ts";
import {
  type Blueprint,
  type InputSchema,
  validateBlueprint,
  validateInput,
} from "./mod.ts";

Deno.test("apps/blueprint#R1: 화면 없는 앱의 빈 screens를 허용하고 누락·중복·모르는 선언은 거절한다", () => {
  sameVerdict(blueprint(), true);
  const value = defineBlueprint(blueprint());
  assertEquals(value.screens, []);
  assertEquals(value.automatic_tasks, []);

  const missing = { ...blueprint() } as Partial<Blueprint>;
  delete missing.permissions;
  sameVerdict(missing, false);
  assert(!validateBlueprint(missing).ok);

  sameVerdict(
    blueprint({
      commands: [
        command("save", "write", { revert: { supported: false } }),
        command("again", "write", { revert: { supported: false } }),
        command("again", "write", { revert: { supported: false } }),
      ],
    }),
    false,
  );
  sameVerdict({ ...blueprint(), context: [] }, false);
});

Deno.test("apps/blueprint#R4: effect는 하나이고 confirm은 effect와 독립이다", () => {
  const value = blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write"),
      command("send", "external", { confirm: false }),
      command("pay", "external", { confirm: true }),
      command("lookup", "read", { confirm: true }),
    ],
  });
  sameVerdict(value, true);
  const defined = defineBlueprint(value);
  assertEquals(
    defined.commands.map((item) => [item.key, item.effect, item.confirm]),
    [
      ["lookup", "read", true],
      ["pay", "external", true],
      ["save", "write", false],
      ["send", "external", false],
      ["undo", "write", false],
    ],
  );
});

Deno.test("apps/blueprint#R5: 캘린더 조회는 read, 저장 동기화는 write, 외부 생성은 external이다", () => {
  const lookup = command("lookup", "read");
  const sync = command("sync", "write", { revert: { supported: false } });
  const create = command("create_event", "external");
  const value = blueprint({ commands: [lookup, sync, create] });
  sameVerdict(value, true);
  const defined = defineBlueprint(value);
  assertEquals(
    defined.commands.map((item) => [item.key, item.effect]),
    [
      ["create_event", "external"],
      ["lookup", "read"],
      ["sync", "write"],
    ],
  );
});

Deno.test("apps/blueprint#R6: secret을 쓰는 read와 write는 confirm=false를 허용한다", () => {
  const value = blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("lookup", "read", { confirm: false }),
      command("save", "write", { confirm: false }),
    ],
    permissions: [secretPermission()],
  });
  sameVerdict(value, true);
  const defined = defineBlueprint(value);
  assertEquals(
    defined.commands.filter((item) => item.key !== "undo").map((item) =>
      item.confirm
    ),
    [false, false],
  );
  assertEquals(defined.permissions[0]?.kind, "secret.use");
});

Deno.test("apps/blueprint#R10: InputSchema는 타입·enum·default·길이·수 범위를 검사하고 default를 채운다", () => {
  const schema: InputSchema = {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 1, maximum: 3, default: 1 },
      label: { type: "string", minLength: 1, maxLength: 4, default: "ok" },
      ratio: { type: "number", minimum: 0, maximum: 1 },
      note: { type: "null" },
      ready: { type: "boolean", enum: [true], default: true },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 2,
      },
      memo: { type: "string" },
    },
    required: ["count", "label", "ready", "tags"],
    additionalProperties: false,
  };
  const filled = validateInput(schema, { tags: ["a"], note: null, ratio: 0.5 });
  assert(filled.ok);
  assertEquals(filled.value, {
    count: 1,
    label: "ok",
    note: null,
    ratio: 0.5,
    ready: true,
    tags: ["a"],
  });
  assert(validateInput(schema, { tags: ["a"] }).ok);
  assert(!validateInput(schema, { tags: [] }).ok);
  assert(!validateInput(schema, { tags: ["a", "b", "c"] }).ok);
  assert(!validateInput(schema, { label: "longer", tags: ["a"] }).ok);
  assert(!validateInput(schema, { count: 4, tags: ["a"] }).ok);
  assert(!validateInput(schema, { ratio: 2, tags: ["a"] }).ok);
  assert(!validateInput(schema, { ready: false, tags: ["a"] }).ok);
  assert(!validateInput(schema, { tags: ["a"], other: 1 }).ok);
  assert(!validateInput(schema, { count: "1", tags: ["a"] }).ok);
  assert(!validateInput(schema, { note: "x", tags: ["a"] }).ok);

  const requiredOnly: InputSchema = {
    type: "object",
    properties: { day: { type: "string" } },
    required: ["day"],
    additionalProperties: false,
  };
  assert(!validateInput(requiredOnly, {}).ok);
  const badDefault: InputSchema = {
    type: "object",
    properties: { day: { type: "string", minLength: 2, default: "a" } },
    additionalProperties: false,
  };
  assert(!validateInput(badDefault, {}).ok);
  const reversed: InputSchema = {
    type: "string",
    minLength: 4,
    maxLength: 1,
  };
  assert(!validateInput(reversed, "ab").ok);
  const reversedCount: InputSchema = {
    type: "array",
    items: { type: "string" },
    minItems: 3,
    maxItems: 1,
  };
  assert(!validateInput(reversedCount, ["a"]).ok);
  sameVerdict(
    blueprint({
      commands: [
        command("undo", "write", { revert: { supported: false } }),
        command("save", "write", { input: badDefault }),
      ],
    }),
    false,
  );
  sameVerdict(
    blueprint({
      commands: [
        command("undo", "write", { revert: { supported: false } }),
        command("save", "write", { input: reversed }),
      ],
    }),
    false,
  );
});

Deno.test("apps/blueprint#R11: $ref·oneOf·format·모르는 keyword를 거절한다", () => {
  for (
    const extra of [
      { $ref: "#/defs/label" },
      { oneOf: [{ type: "string" }] },
      { format: "email" },
      { pattern: "^a" },
    ]
  ) {
    const schema = { type: "string", ...extra } as InputSchema;
    assert(!validateInput(schema, "a").ok);
    sameVerdict(
      blueprint({
        commands: [
          command("undo", "write", { revert: { supported: false } }),
          command("save", "write", { input: schema }),
        ],
      }),
      false,
    );
  }
});
