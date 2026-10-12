import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { validateOutput } from "./output.ts";

const output = z.object({ value: z.unknown() });

function cycle(): unknown {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

Deno.test("platform/ledger#R14: schema strip 전에 raw 비JSON·negative zero를 거절한다", () => {
  const invalid = [
    () => undefined,
    Symbol("private"),
    undefined,
    1n,
    -0,
    NaN,
    Infinity,
    new Date(0),
    new Uint8Array([1]),
    cycle(),
    Array(1),
    { [Symbol("private")]: "value" },
    Object.assign([1], { hidden: () => undefined }),
    Object.assign([1], { "-1": -0 }),
  ];
  for (const raw of invalid) {
    for (const value of [{ value: raw }, { value: "safe", extra: raw }]) {
      const result = validateOutput(output, value);
      assert(!result.ok);
      assertEquals(result.error.code, "internal");
      assertEquals(result.error.message, "internal error");
    }
  }
});

Deno.test("platform/ledger#R14: JSON extra strip은 허용하고 getter를 한 번만 읽은 값으로 검사한다", () => {
  let gets = 0;
  const raw = {
    get value() {
      gets++;
      return gets === 1 ? "safe" : () => "changed";
    },
    extra: { nested: [null, true, 1, "valid"] },
  };
  assertEquals(validateOutput(output, raw), {
    ok: true,
    value: { value: "safe" },
  });
  assertEquals(gets, 1);
  const nullPrototype = Object.assign(Object.create(null), { value: "safe" });
  assertEquals(validateOutput(output, nullPrototype), {
    ok: true,
    value: { value: "safe" },
  });
  assertEquals(validateOutput(output, { value: 0 }), {
    ok: true,
    value: { value: 0 },
  });
});

Deno.test("platform/ledger#R14: metadata override로 raw 비JSON field를 숨길 수 없다", () => {
  const schema = z.object({ value: z.string(), as_of_seq: z.string() });
  for (const as_of_seq of [undefined, () => "private", -0, NaN]) {
    const result = validateOutput(schema, { value: "safe", as_of_seq }, {
      as_of_seq: "1",
    });
    assert(!result.ok);
    assertEquals(result.error.code, "internal");
  }
  assertEquals(
    validateOutput(schema, { value: "safe", as_of_seq: "999" }, {
      as_of_seq: "1",
    }),
    {
      ok: true,
      value: { value: "safe", as_of_seq: "1" },
    },
  );
});

Deno.test("platform/ledger#R14: normalized JSON을 schema 재검증해 값이 달라지면 internal이다", () => {
  const invalid = [
    z.object({ value: z.string().transform((value) => value.length) }),
    z.object({ value: z.string().transform((value) => `${value}!`) }),
    z.object({ value: z.string().transform(() => undefined) }),
    z.object({ value: z.string().transform(() => -0) }),
    z.object({ value: z.string().transform(() => new Date(0)) }),
  ];
  for (const schema of invalid) {
    const result = validateOutput(schema, { value: "abc" });
    assert(!result.ok);
    assertEquals(result.error.code, "internal");
  }
  const stable = z.object({
    value: z.string().transform((value) => value.trim()),
  });
  assertEquals(validateOutput(stable, { value: " abc " }), {
    ok: true,
    value: { value: "abc" },
  });
  const negativeZero = z.object({
    value: z.number().refine((value) => Object.is(value, -0)),
  });
  const result = validateOutput(negativeZero, { value: -0 });
  assert(!result.ok);
});
