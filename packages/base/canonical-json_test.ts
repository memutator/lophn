import { assertEquals, assertThrows } from "@std/assert";
import { canonicalize } from "./canonical-json.ts";

Deno.test("platform/ledger#R13: RFC 8785 3.2.2 example keeps canonical bytes", () => {
  const input = String
    .raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\u000F\u000aA'B\"\\\\\"\/","literals":[null,true,false]}`;
  const expected = String
    .raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
  assertEquals(canonicalize(JSON.parse(input)), expected);
});

Deno.test("platform/ledger#R13: keys sort by UTF-16 code units recursively", () => {
  assertEquals(
    canonicalize({
      "דּ": 7,
      "€": 5,
      "😀": 6,
      "ö": 4,
      "1": 2,
      "\r": 1,
      "\u0080": 3,
    }),
    String.raw`{"\r":1,"1":2,"":3,"ö":4,"€":5,"😀":6,"דּ":7}`,
  );
  assertEquals(
    canonicalize({ z: [{ z: 1, a: 2 }], a: {} }),
    '{"a":{},"z":[{"a":2,"z":1}]}',
  );
  assertEquals(canonicalize({ "2": 2, "10": 10 }), '{"10":10,"2":2}');
});

Deno.test("platform/ledger#R13: numbers use ECMAScript serialization boundaries", () => {
  const cases: [number, string][] = [
    [-0, "0"],
    [1e21, "1e+21"],
    [1e20, "100000000000000000000"],
    [42, "42"],
    [1e-6, "0.000001"],
    [1e-7, "1e-7"],
    [5e-324, "5e-324"],
    [Number.MAX_VALUE, "1.7976931348623157e+308"],
    [9007199254740992, "9007199254740992"],
  ];
  for (const [input, expected] of cases) {
    assertEquals(canonicalize(input), expected);
  }
});

Deno.test("platform/ledger#R13: unsupported values and unpaired surrogates are rejected", () => {
  const invalid: unknown[] = [
    NaN,
    Infinity,
    -Infinity,
    undefined,
    () => 1,
    1n,
    Symbol("value"),
    [undefined],
    { a: undefined },
    [() => 1],
    { a: 1n },
    { a: Symbol("value") },
    "\ud800",
    "\udc00",
    "a\ud800b",
    { "\ud800": 1 },
    new Array(1),
    { [Symbol("key")]: 1 },
    new Map(),
  ];
  for (const value of invalid) {
    assertThrows(() => canonicalize(value), TypeError);
  }
  const cycle: unknown[] = [];
  cycle.push(cycle);
  assertThrows(() => canonicalize(cycle), TypeError);
  assertEquals(canonicalize("😀"), '"😀"');
  const shared = { a: 1 };
  assertEquals(canonicalize([shared, shared]), '[{"a":1},{"a":1}]');
  assertEquals(
    canonicalize(Object.assign(Object.create(null), { a: 1 })),
    '{"a":1}',
  );
});
