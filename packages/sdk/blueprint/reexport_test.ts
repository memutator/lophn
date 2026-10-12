import { assert, assertEquals } from "@std/assert";
import * as contracts from "../../protocol/apps/blueprint.ts";
import * as apps from "../../core/apps/blueprint/mod.ts";
import { defineBlueprint } from "./define.ts";
import { blueprint, command, screen } from "./fixture.ts";
import { canonicalInputHash, validateBlueprint, validateInput } from "./mod.ts";

Deno.test("apps/sdk#R5: SDK와 apps 모듈의 validator는 contracts와 같은 함수다", () => {
  assertEquals(validateBlueprint, contracts.validateBlueprint);
  assertEquals(validateInput, contracts.validateInput);
  assertEquals(canonicalInputHash, contracts.canonicalInputHash);
  assertEquals(apps.validateBlueprint, contracts.validateBlueprint);
  assertEquals(apps.validateInput, contracts.validateInput);
  assertEquals(apps.canonicalInputHash, contracts.canonicalInputHash);
});

Deno.test("apps/sdk#R5: 템플릿 작성형과 직접 선언은 같은 판정을 낸다", () => {
  const direct = {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [{
      key: "home",
      label: "Home",
      path: "/home",
      sizes: ["panel", "full"],
    }],
    commands: [
      {
        key: "undo",
        label: "undo",
        description: "undo purpose",
        effect: "write",
        confirm: false,
        input: null,
        revert: { supported: false },
      },
      {
        key: "save",
        label: "save",
        description: "save purpose",
        effect: "write",
        confirm: true,
        input: null,
        revert: { supported: true, command: "undo" },
      },
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
  const templated = blueprint({
    screens: [screen({ sizes: ["panel", "full"] })],
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write", { confirm: true }),
    ],
  });
  const fromTemplate = defineBlueprint(templated);
  const fromDirect = contracts.validateBlueprint(direct);
  assert(fromDirect.ok);
  assertEquals(fromTemplate, fromDirect.value);

  const legacy = { ...direct, context: [] };
  const directLegacy = contracts.validateBlueprint(legacy);
  assert(!directLegacy.ok);
  let thrown: unknown;
  try {
    defineBlueprint(legacy as contracts.Blueprint);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof TypeError);
  assertEquals(thrown.message, directLegacy.error.message);
});

Deno.test("apps/sdk#R5: SDK runtime import graph는 상대 TS뿐이고 zod·npm·JSR가 없다", async () => {
  const root = new URL(".", import.meta.url);
  const seen = new Set<string>();
  const specifiers: string[] = [];
  async function visit(url: URL) {
    const key = url.pathname;
    if (seen.has(key) || !key.endsWith(".ts")) return;
    if (
      key.endsWith("_test.ts") || key.endsWith("/fixture.ts") ||
      key.endsWith("/judge.ts")
    ) return;
    seen.add(key);
    const text = await Deno.readTextFile(url);
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      specifiers.push(specifier);
      if (specifier.startsWith(".")) {
        await visit(new URL(specifier, url));
      }
    }
  }
  await visit(new URL("./mod.ts", root));
  assert(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert(specifier.startsWith("."), specifier);
    assert(specifier.endsWith(".ts"), specifier);
    assert(!specifier.includes("zod"), specifier);
    assert(!specifier.startsWith("npm:"), specifier);
    assert(!specifier.startsWith("jsr:"), specifier);
  }
  assert(seen.has(new URL("../../contracts/apps/blueprint.ts", root).pathname));
  assert(
    seen.has(new URL("../../contracts/apps/blueprint-value.ts", root).pathname),
  );
});
