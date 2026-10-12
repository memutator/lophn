import { assertEquals } from "@std/assert";
import {
  resultViewSchema,
  searchQuerySchema,
} from "../../../protocol/projects/mod.ts";
import { toBoard } from "./board.ts";
import { fixtureBundle, fixtureEntities, rowOf } from "./testing.ts";
import type { EntityRef } from "./types.ts";

const { contract } = fixtureBundle();
const entities = fixtureEntities();
const exp = (key: string) => rowOf(entities, ["Experiment", key]);
const ref = (key: string): EntityRef => {
  const e = entities.find((x) => x.type === "Experiment" && x.key === key)!;
  return { type: "Experiment", key, path: e.path, section: null };
};
const query = searchQuerySchema.parse({ from: "Experiment" });
const view = (v: unknown) => resultViewSchema.parse(v);
const lanes = (rows: string[], v: unknown) =>
  toBoard(rows.map(exp), query, view(v), contract);

Deno.test("documents/contexts#R15 [ctx-I21]: an enum board has the declared lanes in order, then other values, then null", () => {
  assertEquals(
    lanes(["001", "002", "003", "004", "010"], {
      kind: "board",
      board_by: "status",
    }),
    {
      kind: "board",
      total: 5,
      lanes: [
        { value: "planned", rows: [{ ref: ref("010"), cells: [] }], more: 0 },
        { value: "running", rows: [{ ref: ref("002"), cells: [] }], more: 0 },
        { value: "done", rows: [{ ref: ref("001"), cells: [] }], more: 0 },
        { value: "paused", rows: [{ ref: ref("003"), cells: [] }], more: 0 },
        { value: null, rows: [{ ref: ref("004"), cells: [] }], more: 0 },
      ],
    },
  );
});

Deno.test("documents/contexts#R15 [ctx-I21]: declared enum lanes stay when empty; undeclared and null lanes appear only with rows", () => {
  assertEquals(
    lanes(["002", "010"], { kind: "board", board_by: "status" }).lanes.map((
      l,
    ) => [l.value, l.rows.length]),
    [["planned", 1], ["running", 1], ["done", 0]],
  );
});

Deno.test("documents/contexts#R15 [ctx-I21]: a non-enum board goes by value in code unit order with null last and caps each lane at page_size", () => {
  assertEquals(
    lanes(["001", "002", "003", "004", "010"], {
      kind: "board",
      board_by: "rubric",
      page_size: 1,
    }),
    {
      kind: "board",
      total: 5,
      lanes: [
        {
          value: "schedule-quality",
          rows: [{ ref: ref("001"), cells: [] }],
          more: 1,
        },
        { value: null, rows: [{ ref: ref("003"), cells: [] }], more: 2 },
      ],
    },
  );
});

Deno.test("documents/contexts#R15 [ctx-I21]: board rows carry the declared columns as cells", () => {
  assertEquals(
    lanes(["002"], {
      kind: "board",
      board_by: "status",
      columns: [{ label: "Title", path: "title" }, {
        label: "Id",
        path: "key",
      }],
    }).lanes[1].rows,
    [{
      ref: ref("002"),
      cells: [
        { path: "title", value: "Sight arm", ref: null },
        { path: "key", value: "002", ref: ref("002") },
      ],
    }],
  );
});
