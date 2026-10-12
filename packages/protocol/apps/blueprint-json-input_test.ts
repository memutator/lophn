import { assert, assertEquals } from "@std/assert";
import { canonicalize, fingerprint } from "../../base/mod.ts";
import {
  canonicalInputHash,
  type InputSchema,
  type JsonObject,
  validateBlueprint,
  validateInput,
} from "./blueprint.ts";

function command(key: string): Record<string, unknown> {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect: "write",
    confirm: false,
    input: null,
    revert: { supported: false },
  };
}

function blueprint(): Record<string, unknown> {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [],
    commands: [command("save")],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

function mark(value: object): object {
  Object.defineProperty(value, Symbol("mark"), { value: true });
  return value;
}

Deno.test("apps/blueprint#R10: blueprint collections reject symbols without mutation", () => {
  for (
    const key of [
      "screens",
      "commands",
      "automatic_tasks",
      "permissions",
      "problem_codes",
      "documents",
      "agent_context",
      "app_connections",
      "sdk_dependencies",
    ]
  ) {
    const value = blueprint();
    mark(value[key] as object);
    const before = value.name;
    const parsed = validateBlueprint(value);
    assert(!parsed.ok);
    if (!parsed.ok) assertEquals(parsed.error.code, "invalid_input");
    assertEquals(value.name, before);
    assert(Object.getOwnPropertySymbols(value[key] as object).length === 1);
  }
  const sensitive = blueprint();
  sensitive.agent_context = [{
    screen: "home",
    read_command: "save",
    sensitive_paths: mark(["/secret"]),
    annotation_targets: [],
  }];
  assert(!validateBlueprint(sensitive).ok);
});

Deno.test("apps/blueprint#R10: whole blueprint cycle and lone text do not throw", () => {
  const cycle: Record<string, unknown> = blueprint();
  cycle.screens = [cycle];
  let thrown = false;
  try {
    const parsed = validateBlueprint(cycle);
    assert(!parsed.ok);
  } catch {
    thrown = true;
  }
  assert(!thrown);
  const lone = blueprint();
  lone.name = "a\uD800b";
  assert(!validateBlueprint(lone).ok);
  const finite = blueprint();
  finite.permissions = [{
    kind: "net.fetch",
    reason: "x",
    scope: { host: "a.test", port: Number.NaN },
  }];
  assert(!validateBlueprint(finite).ok);
});

Deno.test("apps/blueprint#R16: a normalized blueprint validates again unchanged", () => {
  const value = blueprint();
  const parsed = validateBlueprint(value);
  assert(parsed.ok);
  if (!parsed.ok) return;
  const again = validateBlueprint(parsed.value);
  assert(again.ok);
  if (!again.ok) return;
  assertEquals(again.value, parsed.value);
  assertEquals(value.commands, [command("save")]);
  const shared = ["ok"];
  const input = validateInput({
    type: "object",
    additionalProperties: false,
    properties: {
      a: { type: "string", enum: shared },
      b: { type: "string", enum: shared },
    },
  }, { a: "ok", b: "ok" });
  assert(input.ok);
});

Deno.test("apps/blueprint#R7 apps/blueprint#R10: declared JSON property names keep own keys and canonical hash", async () => {
  const keys = [
    "__proto__",
    "prototype",
    "constructor",
    "toString",
    "",
    " ",
    "line\nkey",
    "nul\u0000key",
  ];
  const schema: InputSchema = {
    type: "object",
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: "string" }]),
    ),
    required: [...keys],
  };
  const input = Object.fromEntries(keys.map((key) => [key, `value:${key}`]));
  const beforeSchema = canonicalize(schema);
  const beforeInput = canonicalize(input);
  const result = validateInput(schema, input);
  assert(result.ok);
  const output = result.value as JsonObject;
  assertEquals(Object.keys(output).sort(), [...keys].sort());
  assertEquals(canonicalize(output), beforeInput);
  assertEquals(Object.getPrototypeOf(output), Object.prototype);
  const hash = await canonicalInputHash(schema, input);
  assert(hash.ok);
  assertEquals(hash.value, await fingerprint(input));
  assertEquals(canonicalize(schema), beforeSchema);
  assertEquals(canonicalize(input), beforeInput);
  output.__proto__ = "parsed-only";
  assertEquals(canonicalize(input), beforeInput);
  const changed = { ...input, ["__proto__"]: "changed" };
  const changedHash = await canonicalInputHash(schema, changed);
  assert(changedHash.ok);
  assert(changedHash.value !== hash.value);
  assertEquals(Object.getPrototypeOf(input), Object.prototype);
});

Deno.test("apps/blueprint#R7 apps/blueprint#R14 apps/blueprint#R18: own nested JSON keys survive defaults enum and blueprint copies", async () => {
  const schema: InputSchema = JSON.parse(
    '{"type":"object","properties":{"__proto__":{"type":"object","properties":{"prototype":{"type":"string","default":"fixed"}},"default":{}},"items":{"type":"array","items":{"type":"object","properties":{"constructor":{"type":"string"}},"required":["constructor"]},"default":[{"constructor":"fixed"}]}},"required":["__proto__","items"],"enum":[{"__proto__":{"prototype":"fixed"},"items":[{"constructor":"fixed"}]}]}',
  );
  const expected = JSON.parse(
    '{"__proto__":{"prototype":"fixed"},"items":[{"constructor":"fixed"}]}',
  );
  const before = canonicalize(schema);
  const omitted = validateInput(schema, {});
  const explicit = validateInput(schema, expected);
  assert(omitted.ok && explicit.ok);
  assertEquals(canonicalize(omitted.value), canonicalize(expected));
  assertEquals(canonicalize(explicit.value), canonicalize(expected));
  assertEquals(
    await canonicalInputHash(schema, {}),
    await canonicalInputHash(schema, expected),
  );
  assertEquals(canonicalize(schema), before);
  const input = blueprint();
  input.commands = [{ ...command("save"), input: schema }];
  input.automatic_tasks = [{
    key: "repeat",
    label: "Repeat",
    when: { kind: "on_start" },
    command: "save",
    input: {},
  }];
  const parsed = validateBlueprint(input);
  assert(parsed.ok);
  const normalizedSchema = parsed.value.commands[0]!.input!;
  assert(Object.hasOwn(normalizedSchema.properties!, "__proto__"));
  assertEquals(
    Object.getPrototypeOf(normalizedSchema.properties),
    Object.prototype,
  );
  const normalizedInput = parsed.value.automatic_tasks[0]!.input as JsonObject;
  assertEquals(canonicalize(normalizedInput), canonicalize(expected));
  assertEquals(Object.getPrototypeOf(normalizedInput), Object.prototype);
  const again = validateBlueprint(parsed.value);
  assert(again.ok);
  assertEquals(canonicalize(again.value), canonicalize(parsed.value));
  (normalizedInput.__proto__ as JsonObject).prototype = "parsed-only";
  assertEquals(canonicalize(schema), before);
  assertEquals(
    canonicalize(input.automatic_tasks),
    canonicalize([{
      key: "repeat",
      label: "Repeat",
      when: { kind: "on_start" },
      command: "save",
      input: {},
    }]),
  );
  assertEquals(Object.getPrototypeOf({}), Object.prototype);
});
