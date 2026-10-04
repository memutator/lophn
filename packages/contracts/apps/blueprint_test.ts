import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { canonicalize } from "../../base/canonical-json.ts";
import { fingerprint } from "../../base/hash.ts";
import { problemCodeDeclarationSchema } from "../problems/mod.ts";
import {
  canonicalInputHash,
  type InputSchema,
  type ProblemCodeDeclaration,
  validateBlueprint,
  validateInput,
} from "./blueprint.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const OTHER = "app_01bryz6s41s4z4k7p41s4z4k7p";
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

Deno.test("apps/blueprint#R1: empty screens are allowed and duplicates are rejected", () => {
  const value = validateBlueprint(blueprint());
  assert(value.ok);
  assertEquals(value.value.screens, []);
  const duplicate = validateBlueprint(blueprint({
    commands: [
      command("save", "write"),
      command("save", "write", {
        revert: { supported: false },
      }),
    ],
  }));
  assert(!duplicate.ok);
  const unknown = validateBlueprint({ ...blueprint(), context: [] });
  assert(!unknown.ok);
});

Deno.test("apps/blueprint#R4: confirm is independent of external effect", () => {
  const value = validateBlueprint(blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write"),
      command("send", "external", { confirm: false }),
      command("pay", "external", { confirm: true }),
    ],
  }));
  assert(value.ok);
  assertEquals(
    value.value.commands.map((item) => [item.key, item.confirm]),
    [["pay", true], ["save", false], ["send", false], ["undo", false]],
  );
});

Deno.test("apps/blueprint#R10: defaults fill required properties and reject bad bounds", () => {
  const schema: InputSchema = {
    type: "object",
    properties: {
      label: { type: "string", minLength: 1, maxLength: 4, default: "ok" },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 2,
      },
    },
    required: ["label", "tags"],
    additionalProperties: false,
  };
  const filled = validateInput(schema, { tags: ["a"] });
  assert(filled.ok);
  assertEquals(filled.value, { label: "ok", tags: ["a"] });
  const missing = validateInput(schema, {});
  assert(!missing.ok);
  const extra = validateInput(schema, { tags: ["a"], other: 1 });
  assert(!extra.ok);
});

Deno.test("apps/blueprint#R11: unknown schema keywords and unions are rejected", () => {
  const ref = validateInput(
    { type: "string", $ref: "#/x" } as InputSchema,
    "a",
  );
  assert(!ref.ok);
  const format = validateInput(
    { type: "string", format: "email" } as InputSchema,
    "a",
  );
  assert(!format.ok);
});

Deno.test("apps/blueprint#R16: normalized output does not mutate the caller", () => {
  const input = blueprint();
  const value = validateBlueprint(input);
  assert(value.ok);
  assertNotStrictEquals(value.value, input);
  assertEquals(input.commands, blueprint().commands);
});

Deno.test("apps/blueprint#R18: key order changes the same canonical blueprint", () => {
  const first = validateBlueprint(blueprint());
  const reversed = validateBlueprint({
    sdk_dependencies: [],
    app_connections: [],
    agent_context: [],
    documents: [],
    problem_codes: [],
    permissions: [],
    automatic_tasks: [],
    commands: [
      command("save", "write"),
      command("undo", "write", { revert: { supported: false } }),
    ],
    screens: [],
    description: "Keeps one calendar",
    name: "Calendar",
  });
  assert(first.ok && reversed.ok);
  assertEquals(first.value, reversed.value);
});

Deno.test("apps/blueprint#R19: screen sizes must be nonempty and unique", () => {
  const screen = {
    key: "home",
    label: "Home",
    path: "/home",
    sizes: ["full", "panel"],
  };
  const value = validateBlueprint(blueprint({ screens: [screen] }));
  assert(value.ok);
  const empty = validateBlueprint(blueprint({
    screens: [{ ...screen, sizes: [] }],
  }));
  assert(!empty.ok);
  const duplicate = validateBlueprint(blueprint({
    screens: [{ ...screen, sizes: ["card", "card"] }],
  }));
  assert(!duplicate.ok);
});

Deno.test("apps/blueprint#R21: read revert support and self write revert are rejected", () => {
  const read = validateBlueprint(blueprint({
    commands: [
      command("lookup", "read", {
        revert: { supported: true, command: "undo" },
      }),
    ],
  }));
  assert(!read.ok);
  const self = validateBlueprint(blueprint({
    commands: [
      command("save", "write", {
        revert: { supported: true, command: "save" },
      }),
    ],
  }));
  assert(!self.ok);
});

Deno.test("apps/blueprint#R22: self app connection is refused only with owner context", () => {
  const connection = {
    app: APP,
    commands: ["save"],
    reason: "reuse save",
  };
  const open = validateBlueprint(blueprint({ app_connections: [connection] }));
  assert(open.ok);
  const self = validateBlueprint(blueprint({ app_connections: [connection] }), {
    app: APP,
  });
  assert(!self.ok);
  const other = validateBlueprint(
    blueprint({
      app_connections: [{ ...connection, app: OTHER }],
    }),
    { app: APP },
  );
  assert(other.ok);
});

Deno.test("apps/automations#R2: interval below 60000 is rejected and external is allowed", () => {
  const external = command("send", "external");
  const fast = validateBlueprint(blueprint({
    commands: [...(blueprint().commands as unknown[]), external],
    automatic_tasks: [{
      key: "sync",
      label: "Sync",
      when: { kind: "interval", interval_ms: 59999 },
      command: "send",
    }],
  }));
  assert(!fast.ok);
  const ok = validateBlueprint(blueprint({
    commands: [...(blueprint().commands as unknown[]), external],
    automatic_tasks: [{
      key: "sync",
      label: "Sync",
      when: { kind: "interval", interval_ms: 60000 },
      command: "send",
    }],
  }));
  assert(ok.ok);
});

Deno.test("apps/blueprint#R7: omitted and explicit defaults share one input hash", async () => {
  const schema: InputSchema = {
    type: "object",
    additionalProperties: false,
    properties: { label: { type: "string", default: "ok" } },
  };
  const omitted = await canonicalInputHash(schema, {});
  const explicit = await canonicalInputHash(schema, { label: "ok" });
  assert(omitted.ok && explicit.ok);
  assertEquals(omitted.value, explicit.value);
  assertEquals(omitted.value, await fingerprint({ label: "ok" }));
});

Deno.test("apps/blueprint#R10: absent input is not JSON null and type null is distinct", async () => {
  const absent = validateInput(null, undefined);
  assert(absent.ok);
  assertEquals(absent.value, undefined);
  const supplied = validateInput(null, null);
  assert(!supplied.ok);
  const typed = validateInput({ type: "null" }, null);
  assert(typed.ok);
  assertEquals(typed.value, null);
  const absentHash = await canonicalInputHash(null, undefined);
  const nullHash = await canonicalInputHash({ type: "null" }, null);
  assert(absentHash.ok && nullHash.ok);
  assertEquals(absentHash.value, nullHash.value);
  assertEquals(absentHash.value, await fingerprint(null));
});

Deno.test("apps/blueprint#R18: canonical bytes match base canonicalize", async () => {
  const value = validateBlueprint(blueprint({
    screens: [{
      key: "home",
      label: "Home",
      path: "/home",
      sizes: ["card", "full"],
    }],
  }));
  assert(value.ok);
  assertEquals(
    canonicalize(value.value),
    canonicalize(structuredClone(value.value)),
  );
  const hash = await canonicalInputHash({
    type: "object",
    additionalProperties: false,
    properties: { b: { type: "number" }, a: { type: "integer" } },
  }, { b: 1.5, a: 1 });
  assert(hash.ok);
  assertEquals(hash.value, await fingerprint({ a: 1, b: 1.5 }));
});

Deno.test("problems/problem-codes#R1: inline problem code matches the public declaration", () => {
  const declaration: ProblemCodeDeclaration = {
    code: "calendar_missing",
    message_key: "app-detail.issue.calendar_missing",
    message: "The calendar could not be found.",
    fixer: "coding_agent",
  };
  const parsed = problemCodeDeclarationSchema.parse(declaration);
  const value = validateBlueprint(blueprint({ problem_codes: [declaration] }));
  assert(value.ok);
  assertEquals(value.value.problem_codes[0], parsed);
});

Deno.test("apps/blueprint#R10: prototype keys do not change the caller object", () => {
  const payload = JSON.parse(
    '{"__proto__": {"polluted": true}, "label": "ok"}',
  );
  const schema: InputSchema = {
    type: "object",
    additionalProperties: false,
    properties: { label: { type: "string" } },
  };
  const value = validateInput(schema, payload);
  assert(!value.ok);
  assertEquals(({} as { polluted?: boolean }).polluted, undefined);
});
