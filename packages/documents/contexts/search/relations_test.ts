import { assertEquals } from "@std/assert";
import { searchQuerySchema } from "../../../contracts/documents/mod.ts";
import { expandFollows } from "./relations.ts";
import { brief, fixtureBundle, fixtureEntities } from "./testing.ts";

const bundle = fixtureBundle();
const entities = fixtureEntities();
const query = (q: unknown) => searchQuerySchema.parse(q);
const rows = (q: unknown, inputs = {}) =>
  expandFollows(query(q), bundle.contract, entities, inputs).map(brief);

Deno.test("documents/contexts#R15 [ctx-I19]: without follow every entity of the start type is a row in extraction order", () => {
  assertEquals(rows({ from: "Experiment" }), [
    "Experiment:001",
    "Experiment:002",
    "Experiment:003",
    "Experiment:004",
    "Experiment:010",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I19]: query.where is not applied here (the runner filters after the join)", () => {
  assertEquals(
    rows({
      from: "Scenario",
      where: { path: "key", op: "eq", value: "travel" },
    }),
    ["Scenario:schedule-basic", "Scenario:travel"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I19]: forward follow joins the target of each edge and drops rows with no target", () => {
  // F-003은 없는 실험 099를 가리킨다.
  assertEquals(
    rows(bundle.searches[0].query),
    ["Finding:001+exp=Experiment:001", "Finding:002+exp=Experiment:002"],
  );
});

Deno.test("documents/contexts#R15 [ctx-I19]: several targets give one row each, in the targets' extraction order", () => {
  assertEquals(
    rows({
      from: "Experiment",
      follow: [{ relation: "runs_on", as: "scn", direction: "forward" }],
    }),
    [
      "Experiment:001+scn=Scenario:schedule-basic",
      "Experiment:002+scn=Scenario:schedule-basic",
      "Experiment:002+scn=Scenario:travel",
      "Experiment:004+scn=Scenario:travel",
    ],
  );
});

Deno.test("documents/contexts#R15 [ctx-I19]: reverse follow finds entities whose edge points at the row", () => {
  assertEquals(rows(bundle.searches[2].query), [
    "Scenario:schedule-basic+exp=Experiment:001",
    "Scenario:schedule-basic+exp=Experiment:002",
    "Scenario:travel+exp=Experiment:002",
    "Scenario:travel+exp=Experiment:004",
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I19]: follow continues from an earlier alias", () => {
  assertEquals(
    rows({
      from: "Finding",
      follow: [
        { relation: "about", as: "exp", direction: "forward" },
        { relation: "runs_on", as: "scn", from: "exp", direction: "forward" },
      ],
    }),
    [
      "Finding:001+exp=Experiment:001+scn=Scenario:schedule-basic",
      "Finding:002+exp=Experiment:002+scn=Scenario:schedule-basic",
      "Finding:002+exp=Experiment:002+scn=Scenario:travel",
    ],
  );
});

Deno.test("documents/contexts#R15 [ctx-I19]: follow.where keeps only targets that pass, with inputs", () => {
  const q = {
    from: "Finding",
    follow: [{
      relation: "about",
      as: "exp",
      direction: "forward",
      where: { path: "exp.status", op: "eq", value: { input: "status" } },
    }],
  };
  assertEquals(rows(q, { status: "running" }), [
    "Finding:002+exp=Experiment:002",
  ]);
  // 주지 않은 선택 입력은 참
  assertEquals(rows(q), [
    "Finding:001+exp=Experiment:001",
    "Finding:002+exp=Experiment:002",
  ]);
});
