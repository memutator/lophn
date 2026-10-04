import { assert, assertEquals } from "@std/assert";
import { canonicalInputHash, type InputSchema, validateInput } from "./mod.ts";

Deno.test("apps/blueprint#R7: 생략한 default와 명시한 default는 같은 input hash다", async () => {
  const schema: InputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string", default: "ok" },
      count: { type: "integer", default: 1 },
    },
    required: ["label", "count"],
  };
  const omitted = await canonicalInputHash(schema, {});
  const explicit = await canonicalInputHash(schema, { count: 1, label: "ok" });
  assert(omitted.ok && explicit.ok);
  assertEquals(omitted.value, explicit.value);

  const filled = validateInput(schema, {});
  assert(filled.ok);
  assertEquals(filled.value, { count: 1, label: "ok" });

  const claimed = await canonicalInputHash(schema, { label: "other" });
  assert(claimed.ok);
  assert(claimed.value !== omitted.value);
});
