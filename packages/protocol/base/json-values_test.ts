import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import { jsonObjectSchema, jsonValueSchema } from "./json-values.ts";

Deno.test("platform/ledger#R13: JSON schema preserves own prototype-like keys and canonical bytes", () => {
  const value = JSON.parse(
    '{"__proto__":{"value":"kept"},"constructor":[{"prototype":null,"__proto__":"nested"}],"keep":{"__proto__":42}}',
  );
  const parsed = jsonObjectSchema.parse(value);
  assertEquals(Object.keys(parsed), ["__proto__", "constructor", "keep"]);
  assertEquals(canonicalize(parsed), canonicalize(value));
  assertEquals(Object.getPrototypeOf(parsed), Object.prototype);
  assertEquals(jsonValueSchema.parse([value, null, false]), [
    value,
    null,
    false,
  ]);
  assertEquals(canonicalize(jsonValueSchema.parse(value)), canonicalize(value));
});

Deno.test("platform/ledger#R13: JSON schema rejects non-JSON values without coercion or throwing", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const invalid = [
    undefined,
    NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol("value"),
    () => 1,
    { value: undefined },
    { value: 1n },
    new Date(),
    new Map(),
    [undefined],
    new Array(1),
    "\ud800",
    { "\ud800": 1 },
    cycle,
    { [Symbol("key")]: "value" },
  ];
  for (const value of invalid) {
    assert(!jsonValueSchema.safeParse(value).success);
    assert(!jsonObjectSchema.safeParse(value).success);
  }
  for (const value of [null, true, "text", 1, [], [1, "text"]]) {
    assert(jsonValueSchema.safeParse(value).success);
    assert(!jsonObjectSchema.safeParse(value).success);
  }
  assert(jsonObjectSchema.safeParse({}).success);
  assert(jsonObjectSchema.safeParse(Object.create(null)).success);
});
