import { assert, assertEquals } from "@std/assert";
import { validateBlueprint, validateInput } from "./blueprint.ts";

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
