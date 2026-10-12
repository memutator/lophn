import { assert, assertEquals } from "@std/assert";
import {
  type ProblemCodeDeclaration as PublicProblemCode,
  problemCodeDeclarationSchema,
} from "../problems/mod.ts";
import {
  canonicalInputHash,
  type InputSchema,
  type ProblemCodeDeclaration,
  validateBlueprint,
  validateInput,
} from "./blueprint.ts";
import { pointer, semver } from "./blueprint-scope.ts";
import { jsonPointerSchema } from "./agent-context.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";

function command(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: effect === "write"
      ? { supported: true, command: "undo" }
      : { supported: false },
    ...extra,
  };
}

function blueprint(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [],
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write"),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
    ...extra,
  };
}

Deno.test("apps/blueprint#R11: enum matches the value after defaults", async () => {
  const schema: InputSchema = {
    type: "object",
    properties: {
      label: { type: "string", default: "ok" },
    },
    additionalProperties: false,
    enum: [{ label: "ok" }],
  };
  const omitted = validateInput(schema, {});
  const explicit = validateInput(schema, { label: "ok" });
  assert(omitted.ok && explicit.ok);
  assertEquals(omitted.value, { label: "ok" });
  assertEquals(explicit.value, omitted.value);
  assertEquals(
    await canonicalInputHash(schema, {}),
    await canonicalInputHash(schema, { label: "ok" }),
  );
  const again = validateInput(schema, omitted.value);
  assert(again.ok);
  assertEquals(again.value, omitted.value);
  assertEquals(
    await canonicalInputHash(schema, again.value),
    await canonicalInputHash(schema, {}),
  );
  const nested: InputSchema = {
    type: "object",
    properties: {
      item: {
        type: "object",
        properties: { n: { type: "integer", default: 1 } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    enum: [{ item: { n: 1 } }],
  };
  const filled = validateInput(nested, { item: {} });
  assert(filled.ok);
  assertEquals(filled.value, { item: { n: 1 } });
  const bounded = validateInput(
    { type: "integer", minimum: 0.5, maximum: 1.5 },
    1,
  );
  assert(bounded.ok);
  assertEquals(bounded.value, 1);
  const described = validateInput(
    { type: "string", description: "" },
    "ok",
  );
  assert(described.ok);
  const shared = ["ok"];
  const dag: InputSchema = {
    type: "object",
    properties: {
      a: { type: "string", enum: shared },
      b: { type: "string", enum: shared },
    },
    additionalProperties: false,
  };
  const reused = validateInput(dag, { a: "ok", b: "ok" });
  assert(reused.ok);
  const loop: string[] = [];
  loop.push(loop as never);
  const cyclicEnum: InputSchema = { type: "string", enum: loop as never };
  assert(!validateInput(cyclicEnum, "ok").ok);
  const tagged = ["ok"] as string[];
  Object.defineProperty(tagged, Symbol("mark"), { value: true });
  assert(
    !validateInput({ type: "array", items: { type: "string" } }, tagged).ok,
  );
});

Deno.test("apps/blueprint#R10: cyclic and non-JSON schema returns invalid_input", () => {
  const self: InputSchema = { type: "object", additionalProperties: false };
  self.properties = { child: self };
  const cyclic = validateInput(self, {});
  assert(!cyclic.ok);
  if (!cyclic.ok) assertEquals(cyclic.error.code, "invalid_input");
  const items: InputSchema = { type: "array" };
  items.items = items;
  assert(!validateInput(items, []).ok);
  const choice: { label?: unknown } = {};
  const withEnum: InputSchema = {
    type: "object",
    additionalProperties: false,
    enum: [choice as never],
  };
  choice.label = withEnum;
  assert(!validateInput(withEnum, {}).ok);
  const looped = { type: "string", default: undefined as unknown };
  looped.default = looped;
  assert(!validateInput(looped as InputSchema, "ok").ok);
  const original = { type: "string", extra: () => 1 };
  const rejected = validateInput(original as never, "ok");
  assert(!rejected.ok);
  assertEquals(typeof original.extra, "function");
  for (
    const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      Symbol("x"),
    ]
  ) {
    const bad = validateInput({ type: "string" }, value as never);
    assert(!bad.ok);
  }
  const lone = validateInput({ type: "string" }, "a\uD800b");
  assert(!lone.ok);
  const proto = Object.create({ hidden: true }) as Record<string, unknown>;
  proto.type = "string";
  const before = Object.getPrototypeOf(proto);
  assert(!validateInput(proto as never, "ok").ok);
  assertEquals(Object.getPrototypeOf(proto), before);
  const body = blueprint();
  const badBlueprint = validateBlueprint(body, { app: [APP] as never });
  assert(!badBlueprint.ok);
  assertEquals(body.name, "Calendar");
});

Deno.test("apps/blueprint#R22: owner context must be an app ID string", () => {
  const value = blueprint({
    app_connections: [{ app: APP, commands: ["save"], reason: "same app" }],
  });
  for (const app of [APP, 1, [APP], { toString: () => APP }, null]) {
    const parsed = validateBlueprint(value, { app: app as never });
    assert(!parsed.ok);
  }
  const other = "app_01bryz6s41s4z4k7p41s4z4k7p";
  const kept = validateBlueprint(value, { app: other });
  assert(kept.ok);
  const self = validateBlueprint(value, { app: APP });
  assert(!self.ok);
  const spaced = validateBlueprint(blueprint({
    app_connections: [{
      app: other,
      commands: [" save"],
      reason: "padded",
    }],
  }));
  assert(!spaced.ok);
});

Deno.test("apps/blueprint#R7: numeric prerelease rejects a leading zero", () => {
  assert(semver("1.0.0"));
  assert(semver("1.0.0-0"));
  assert(semver("1.0.0-alpha.0"));
  assert(semver("1.0.0+build.01"));
  assertEquals(semver("1.0.0-01"), false);
  assertEquals(semver("1.0.0-alpha.01"), false);
});

const POINTERS: Array<[string, boolean]> = [
  ["", true],
  ["/", true],
  ["/data/a~1b", true],
  ["/data/a~0b", true],
  ["/data/a~01b", true],
  ["/data/a~", false],
  ["/data/a~2", false],
  ["/data/a~~01b", false],
  ["data", false],
  ["/data/a\uD800", false],
];

Deno.test("apps/agent-context#R4: JSON Pointer escapes match RFC 6901", () => {
  for (const [value, ok] of POINTERS) {
    assertEquals(pointer(value), ok, value);
    assertEquals(jsonPointerSchema.safeParse(value).success, ok, value);
  }
});

type _PureToPublic = ProblemCodeDeclaration extends PublicProblemCode ? true
  : never;
type _PublicToPure = PublicProblemCode extends ProblemCodeDeclaration ? true
  : never;
const _assignable: [_PureToPublic, _PublicToPure] = [true, true];

Deno.test("problems/problem-codes#R1: pure and public problem codes accept the same corpus", () => {
  assert(_assignable[0] && _assignable[1]);
  const cases: unknown[] = [
    {
      code: "calendar_missing",
      message_key: "app.calendar.missing_event",
      message: "The event is missing.",
      fixer: "user",
    },
    {
      code: "unexpected_error",
      message_key: "app-detail.issue.unexpected_error",
      message: "Something went wrong in this app.",
      fixer: "coding_agent",
    },
    {
      code: "a".repeat(49),
      message_key: "app.calendar.missing_event",
      message: "The event is missing.",
      fixer: "user",
    },
    {
      code: "calendar_missing",
      message_key: "app.calendar.missing_event",
      message: "line\nbreak",
      fixer: "user",
    },
    {
      code: "calendar_missing",
      message_key: "app.calendar.missing_event",
      message: "has {placeholder}",
      fixer: "user",
    },
    {
      code: "calendar_missing",
      message_key: "app.calendar.missing_event",
      message: "The event is missing.",
      fixer: "operator",
    },
  ];
  for (const [index, value] of cases.entries()) {
    const pure = validateBlueprint(blueprint({ problem_codes: [value] }));
    const pub = problemCodeDeclarationSchema.safeParse(value);
    if (index < 2) {
      assert(pure.ok);
      assert(pub.success);
    } else {
      assert(!pure.ok);
      assert(!pub.success);
    }
  }
  const lone = {
    code: "calendar_missing",
    message_key: "app.calendar.missing_event",
    message: "bad\uD800text",
    fixer: "user",
  };
  assert(!validateBlueprint(blueprint({ problem_codes: [lone] })).ok);
  assert(!problemCodeDeclarationSchema.safeParse(lone).success);
  const scalar = { ...lone, message: "𐐀 record." };
  assert(validateBlueprint(blueprint({ problem_codes: [scalar] })).ok);
  assert(problemCodeDeclarationSchema.safeParse(scalar).success);
});

Deno.test("apps/blueprint#R20: command input description must be nonblank when present", () => {
  const blank = validateBlueprint(blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write", {
        input: { type: "string", description: "" },
      }),
    ],
  }));
  assert(!blank.ok);
  const spaces = validateBlueprint(blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write", {
        input: {
          type: "object",
          additionalProperties: false,
          properties: { label: { type: "string", description: "   " } },
        },
      }),
    ],
  }));
  assert(!spaces.ok);
  const absent = validateBlueprint(blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write", { input: { type: "string" } }),
    ],
  }));
  assert(absent.ok);
  const nested = validateInput(
    { type: "array", items: { type: "string", description: "" } },
    ["ok"],
  );
  assert(nested.ok);
});

Deno.test("apps/blueprint#R10: symbol-bearing schema nodes match on both entries", () => {
  const marked = (value: object): object => {
    Object.defineProperty(value, Symbol("mark"), { value: true });
    return value;
  };
  const cases = [
    { type: "string", enum: marked(["ok"]) },
    {
      type: "object",
      required: marked(["label"]),
      properties: { label: { type: "string" } },
      additionalProperties: false,
    },
    {
      type: "object",
      properties: marked({ label: { type: "string" } }),
      additionalProperties: false,
    },
    { type: "array", items: marked({ type: "string" }) },
  ];
  for (const schema of cases) {
    const before = JSON.stringify(
      schema,
      (_, item) => typeof item === "symbol" ? undefined : item,
    );
    const direct = validateInput(
      schema as never,
      schema.type === "array"
        ? ["ok"]
        : schema.type === "object"
        ? { label: "ok" }
        : "ok",
    );
    const via = validateBlueprint(blueprint({
      commands: [
        command("undo", "write", { revert: { supported: false } }),
        command("save", "write", { input: schema }),
      ],
    }));
    assert(!direct.ok && !via.ok);
    if (!direct.ok && !via.ok) assertEquals(direct.error.code, via.error.code);
    assertEquals(
      JSON.stringify(
        schema,
        (_, item) => typeof item === "symbol" ? undefined : item,
      ),
      before,
    );
  }
});
