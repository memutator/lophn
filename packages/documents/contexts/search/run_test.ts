import { assertEquals } from "@std/assert";
import { bundleContentSchema } from "../../../protocol/projects/mod.ts";
import { runSearch } from "./run.ts";
import { fixtureBundle, fixtureEntities } from "./testing.ts";
import type { EntityRef, SearchResult } from "./types.ts";

const bundle = fixtureBundle();
const entities = fixtureEntities();
const ref = (type: string, key: string): EntityRef => {
  const e = entities.find((x) => x.type === type && x.key === key)!;
  return { type, key, path: e.path, section: e.section };
};
const run = (search: string, inputs = {}, b = bundle, cursor?: string | null) =>
  runSearch({ bundle: b, search, inputs, entities, cursor });
const table = (
  rows: unknown[],
  total = rows.length,
  next_cursor: string | null = null,
): SearchResult => ({
  ok: true,
  result: { kind: "table", rows, total, next_cursor },
} as SearchResult);

Deno.test("documents/contexts#R15 #R16 [ctx-I22]: findings for an experiment, newest first, with links to the objects", () => {
  assertEquals(
    run("findings_for_experiment", { experiment: "002" }),
    table([{
      ref: ref("Finding", "002"),
      cells: [
        { path: "key", value: "002", ref: ref("Finding", "002") },
        { path: "title", value: "Sight is mixed", ref: null },
        { path: "exp.status", value: "running", ref: null },
      ],
    }]),
  );
  // F-003은 없는 실험을 가리켜 join에서 빠진다.
  assertEquals(
    run("findings_for_experiment", { experiment: "099" }),
    table([]),
  );
});

Deno.test("documents/contexts#R15 [ctx-I22]: experiments by status as a board", () => {
  assertEquals(
    run("experiments_by_status", { status: ["running", "planned"] }),
    {
      ok: true,
      result: {
        kind: "board",
        total: 2,
        lanes: [
          {
            value: "planned",
            rows: [{ ref: ref("Experiment", "010"), cells: [] }],
            more: 0,
          },
          {
            value: "running",
            rows: [{ ref: ref("Experiment", "002"), cells: [] }],
            more: 0,
          },
          { value: "done", rows: [], more: 0 },
        ],
      },
    },
  );
  const all = run("experiments_by_status");
  assertEquals(
    all.ok && all.result.kind === "board"
      ? all.result.lanes.map((l) => [l.value, l.rows.map((r) => r.ref.key)])
      : all,
    [
      ["planned", ["010"]],
      ["running", ["002"]],
      ["done", ["001"]],
      ["paused", ["003"]],
      [null, ["004"]],
    ],
  );
});

Deno.test("documents/contexts#R15 [ctx-I22]: experiments that run on a scenario follow the relation backwards", () => {
  assertEquals(
    run("experiments_on_scenario", { scenario: "travel" }),
    table([
      {
        ref: ref("Scenario", "travel"),
        cells: [
          { path: "exp.key", value: "002", ref: ref("Experiment", "002") },
          { path: "exp.status", value: "running", ref: null },
        ],
      },
      {
        ref: ref("Scenario", "travel"),
        cells: [
          { path: "exp.key", value: "004", ref: ref("Experiment", "004") },
          { path: "exp.status", value: null, ref: null },
        ],
      },
    ]),
  );
});

const extra = bundleContentSchema.parse({
  ...structuredClone(bundle),
  searches: [
    ...bundle.searches,
    {
      name: "all_experiments",
      title: "All experiments",
      query: { from: "Experiment" },
      result: {
        kind: "table",
        columns: [{ label: "Id", path: "key" }],
        page_size: 2,
      },
    },
    {
      name: "all_experiments_desc",
      title: "All experiments, newest first",
      query: { from: "Experiment", sort: [{ path: "key", dir: "desc" }] },
      result: {
        kind: "table",
        columns: [{ label: "Id", path: "key" }],
        page_size: 2,
      },
    },
    {
      name: "grouped",
      title: "Experiments grouped by status",
      query: { from: "Experiment", group: { by: "status" } },
      result: { kind: "table", columns: [{ label: "Id", path: "key" }] },
    },
  ],
});
const keysOf = (r: SearchResult) =>
  r.ok && r.result.kind === "table" ? r.result.rows.map((x) => x.ref.key) : r;

Deno.test("documents/contexts#R17 [ctx-I22]: a table pages through the cursor and a cursor of another search is rejected", () => {
  const first = run("all_experiments", {}, extra);
  assertEquals(keysOf(first), ["001", "002"]);
  const cursor = first.ok && first.result.kind === "table"
    ? first.result.next_cursor
    : null;
  const second = run("all_experiments", {}, extra, cursor);
  assertEquals(keysOf(second), ["003", "004"]);
  const third = run(
    "all_experiments",
    {},
    extra,
    second.ok && second.result.kind === "table"
      ? second.result.next_cursor
      : null,
  );
  assertEquals(keysOf(third), ["010"]);
  assertEquals(
    third.ok && third.result.kind === "table"
      ? [third.result.total, third.result.next_cursor]
      : third,
    [5, null],
  );
  assertEquals(run("all_experiments_desc", {}, extra, cursor), {
    ok: false,
    error: { code: "cursor_mismatch" },
  });
});

Deno.test("documents/contexts#R15 [ctx-I22]: grouped table rows carry their group value", () => {
  const result = run("grouped", {}, extra);
  assertEquals(
    result.ok && result.result.kind === "table"
      ? result.result.rows.map((r) => [r.ref.key, r.group])
      : result,
    [["001", "done"], ["003", "paused"], ["010", "planned"], [
      "002",
      "running",
    ], ["004", null]],
  );
});

Deno.test("documents/contexts#R15 [ctx-I22]: unknown searches and bad inputs come back as errors", () => {
  assertEquals(run("nope"), {
    ok: false,
    error: { code: "search_unknown" },
  });
  assertEquals(run("findings_for_experiment"), {
    ok: false,
    error: { code: "input_required", input: "experiment" },
  });
  assertEquals(run("findings_for_experiment", { experiment: 2 }), {
    ok: false,
    error: { code: "input_invalid", input: "experiment" },
  });
});

Deno.test("documents/contexts#R17 [ctx-I22]: the same call twice gives the same result", () => {
  assertEquals(
    run("experiments_on_scenario", { scenario: "schedule-basic" }),
    run("experiments_on_scenario", { scenario: "schedule-basic" }),
  );
});
