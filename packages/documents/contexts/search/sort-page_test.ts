import { assertEquals } from "@std/assert";
import { searchQuerySchema } from "../../../protocol/projects/mod.ts";
import { paginate, sortRows } from "./sort-page.ts";
import { brief, fixtureEntities, rowOf } from "./testing.ts";

const entities = fixtureEntities();
const query = (q: unknown) => searchQuerySchema.parse(q);
const experiments = ["010", "003", "001", "004", "002"].map((k) =>
  rowOf(entities, ["Experiment", k])
);
const keys = (q: unknown, rows = experiments, series = true) =>
  sortRows(rows, query(q), series).map((r) => r.base.key);

Deno.test("documents/contexts#R15 [ctx-I20]: without sort a series type keeps extraction (number) order", () => {
  assertEquals(keys({ from: "Experiment" }), [
    "001",
    "002",
    "003",
    "004",
    "010",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I20]: without sort other types go by key in code unit order", () => {
  const decisions = [
    rowOf(entities, ["Decision", "Use SQLite"]),
    rowOf(entities, ["Decision", "Drop backup"]),
  ];
  assertEquals(keys({ from: "Decision" }, decisions, false), [
    "Drop backup",
    "Use SQLite",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I20]: sort puts null last in both directions", () => {
  // status: 001 done, 002 running, 003 paused, 004 null, 010 planned
  assertEquals(
    keys({ from: "Experiment", sort: [{ path: "status", dir: "asc" }] }),
    ["001", "003", "010", "002", "004"],
  );
  assertEquals(
    keys({ from: "Experiment", sort: [{ path: "status", dir: "desc" }] }),
    ["002", "010", "003", "001", "004"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I20]: later sort keys break ties of earlier ones", () => {
  assertEquals(
    keys({
      from: "Experiment",
      sort: [{ path: "rubric", dir: "asc" }, { path: "key", dir: "desc" }],
    }),
    ["002", "001", "010", "004", "003"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I20]: full ties go by start key, path, then the alias entities' extraction order", () => {
  const joined = [
    rowOf(entities, ["Scenario", "travel"], { exp: ["Experiment", "004"] }),
    rowOf(entities, ["Scenario", "travel"], { exp: ["Experiment", "002"] }),
    rowOf(entities, ["Scenario", "schedule-basic"], {
      exp: ["Experiment", "002"],
    }),
    rowOf(entities, ["Scenario", "schedule-basic"], {
      exp: ["Experiment", "001"],
    }),
  ];
  assertEquals(
    sortRows(joined, query({ from: "Scenario" }), false).map(brief),
    [
      "Scenario:schedule-basic+exp=Experiment:001",
      "Scenario:schedule-basic+exp=Experiment:002",
      "Scenario:travel+exp=Experiment:002",
      "Scenario:travel+exp=Experiment:004",
    ],
  );
});

Deno.test("documents/contexts#R15 [ctx-I20]: group orders by the group value first with the same comparison", () => {
  assertEquals(
    keys({ from: "Experiment", group: { by: "status" } }),
    ["001", "003", "010", "002", "004"],
  );
});

Deno.test("documents/contexts#R17 [ctx-I20]: pages follow each other through the cursor and end with null", () => {
  const items = [1, 2, 3, 4, 5];
  const first = paginate(items, 2, null, "fp-a");
  if (!first.ok) throw new Error("first page failed");
  assertEquals([first.items, first.total], [[1, 2], 5]);
  const second = paginate(items, 2, first.next_cursor, "fp-a");
  if (!second.ok) throw new Error("second page failed");
  assertEquals([second.items, second.total], [[3, 4], 5]);
  const third = paginate(items, 2, second.next_cursor, "fp-a");
  if (!third.ok) throw new Error("third page failed");
  assertEquals([third.items, third.next_cursor], [[5], null]);
  assertEquals(paginate([], 2, null, "fp-a"), {
    ok: true,
    items: [],
    total: 0,
    next_cursor: null,
  });
});

Deno.test("documents/contexts#R17 [ctx-I20]: a cursor of another search or input, or a malformed one, is cursor_mismatch", () => {
  const first = paginate([1, 2, 3], 2, null, "fp-a");
  if (!first.ok || first.next_cursor === null) throw new Error("no cursor");
  const mismatch = {
    ok: false as const,
    error: { code: "cursor_mismatch" as const },
  };
  assertEquals(paginate([1, 2, 3], 2, first.next_cursor, "fp-b"), mismatch);
  assertEquals(paginate([1, 2, 3], 2, "garbage", "fp-a"), mismatch);
});
