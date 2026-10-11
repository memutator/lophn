import { assert, assertEquals } from "@std/assert";
import type { Condition } from "../../../contracts/documents/mod.ts";
import { fixtureEntities, rowOf } from "./testing.ts";
import type { Row } from "./types.ts";
import { evaluate } from "./where.ts";

const entities = fixtureEntities();
// Experiment 001 done [schedule-basic] rubric / 002 running [schedule-basic, travel] rubric /
// 003 paused [] / 004 null [travel] / 010 planned [moon-trip]
const exp = (key: string) => rowOf(entities, ["Experiment", key]);
const finding = (key: string, expKey?: string) =>
  rowOf(
    entities,
    ["Finding", key],
    expKey === undefined ? {} : { exp: ["Experiment", expKey] },
  );
const holds = (c: Condition, row: Row, inputs = {}) => evaluate(c, row, inputs);
const which = (c: Condition, inputs = {}) =>
  ["001", "002", "003", "004", "010"].filter((k) =>
    evaluate(c, exp(k), inputs)
  );

Deno.test("documents/contexts#R15 [ctx-I18]: eq and ne compare values; ne is the negation of eq", () => {
  assertEquals(which({ path: "status", op: "eq", value: "running" }), ["002"]);
  assertEquals(which({ path: "status", op: "ne", value: "done" }), [
    "002",
    "003",
    "004",
    "010",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I18]: a list value matches when one item matches", () => {
  assertEquals(which({ path: "scenarios", op: "eq", value: "travel" }), [
    "002",
    "004",
  ]);
  assertEquals(
    which({ path: "scenarios", op: "contains", value: "schedule-basic" }),
    ["001", "002"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I18]: in, and eq with an array, match any of the values", () => {
  assertEquals(which({ path: "status", op: "in", value: ["paused"] }), [
    "003",
  ]);
  assertEquals(
    which({ path: "status", op: "eq", value: ["running", "done"] }),
    ["001", "002"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I18]: lt, lte, gt, gte compare numbers by value and strings by code unit; null is false", () => {
  assertEquals(which({ path: "key", op: "gte", value: "003" }), [
    "003",
    "004",
    "010",
  ]);
  assertEquals(which({ path: "key", op: "lt", value: "002" }), ["001"]);
  assertEquals(which({ path: "rubric", op: "gte", value: "a" }), [
    "001",
    "002",
  ]);
  const numbered: Row = {
    base: {
      type: "T",
      key: "a",
      path: "t/a.md",
      section: null,
      fields: { n: 5, missing: null },
      links: [],
    },
    base_index: 0,
    aliases: {},
  };
  assert(holds({ path: "n", op: "lt", value: 10 }, numbered));
  assert(holds({ path: "n", op: "gte", value: 5 }, numbered));
  assert(!holds({ path: "n", op: "gt", value: 5 }, numbered));
  // 수와 문자열은 서로 비교하지 않는다
  assert(!holds({ path: "n", op: "lt", value: "9" }, numbered));
  assert(!holds({ path: "missing", op: "lt", value: 10 }, numbered));
});

Deno.test("documents/contexts#R15 [ctx-I18]: contains is a case-sensitive substring for strings", () => {
  assert(holds({ path: "title", op: "contains", value: "arm" }, exp("001")));
  assert(!holds({ path: "title", op: "contains", value: "Arm" }, exp("001")));
  assert(
    !holds({ path: "title", op: "contains", value: "arm" }, finding("001")),
  );
});

Deno.test("documents/contexts#R15 [ctx-I18]: exists is false for null and for an empty list", () => {
  assertEquals(which({ path: "rubric", op: "exists" }), ["001", "002"]);
  assertEquals(which({ path: "scenarios", op: "exists" }), [
    "001",
    "002",
    "004",
    "010",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I18]: alias paths read the joined entity and a missing alias reads null", () => {
  assert(
    holds(
      { path: "exp.status", op: "eq", value: "running" },
      finding("002", "002"),
    ),
  );
  assert(!holds({ path: "exp.status", op: "exists" }, finding("002")));
});

Deno.test("documents/contexts#R15 [ctx-I18]: all, any and not combine conditions", () => {
  assertEquals(
    which({
      all: [
        { path: "scenarios", op: "exists" },
        { not: { path: "status", op: "eq", value: "running" } },
      ],
    }),
    ["001", "004", "010"],
  );
  assertEquals(
    which({
      any: [
        { path: "status", op: "eq", value: "paused" },
        { path: "rubric", op: "exists" },
      ],
    }),
    ["001", "002", "003"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I18]: input references take the input value and an omitted optional input makes the condition true", () => {
  assert(
    holds(
      { path: "experiment", op: "eq", value: { input: "experiment" } },
      finding("002"),
      { experiment: "002" },
    ),
  );
  assertEquals(
    which({ path: "status", op: "eq", value: { input: "status" } }),
    ["001", "002", "003", "004", "010"],
  );
  assertEquals(
    which({
      all: [
        { path: "status", op: "eq", value: { input: "status" } },
        { path: "status", op: "eq", value: "done" },
      ],
    }),
    ["001"],
  );
  assertEquals(
    which({ path: "status", op: "eq", value: { input: "status" } }, {
      status: ["running", "planned"],
    }),
    ["002", "010"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I18]: a range input includes both ends and may leave one open", () => {
  const within = {
    path: "key",
    op: "eq" as const,
    value: { input: "between" },
  };
  assertEquals(which(within, { between: { from: "002", to: "004" } }), [
    "002",
    "003",
    "004",
  ]);
  assertEquals(which(within, { between: { from: "004" } }), ["004", "010"]);
  assertEquals(which(within, { between: { to: "001" } }), ["001"]);
});
