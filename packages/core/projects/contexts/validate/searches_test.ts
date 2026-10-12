import { assertEquals } from "@std/assert";
import { changed, sampleBundle, sampleEnv } from "./sample.ts";
import { checkSearches } from "./searches.ts";
import { type ContractIssue, sortIssues } from "./types.ts";
import type { BundleContent } from "../../../../protocol/projects/mod.ts";

const issues = (bundle: BundleContent): ContractIssue[] =>
  sortIssues(checkSearches(bundle, sampleEnv()));
const at = (code: ContractIssue["code"], ...path: (string | number)[]) => ({
  code,
  path,
});
// searches: 0 findings_for_experiment(from Finding, follow about as exp, input experiment required)
//           1 experiments_by_status(from Experiment, input status value many, board by status)
//           2 experiments_on_scenario(from Scenario, follow runs_on reverse as exp)
const S = (index: number, ...rest: (string | number)[]) =>
  ["searches", index, ...rest] as const;

Deno.test("documents/contexts#R15 [ctx-I4]: the sample searches, examples and saved views have no issues", () => {
  assertEquals(issues(sampleBundle()), []);
});

Deno.test("documents/contexts#R15 [ctx-I4]: a search starts from a type of the contract", () => {
  // from이 없으면 그 검색의 나머지는 보지 않는다.
  assertEquals(
    issues(changed((b) => b.searches[0].query.from = "Findings")),
    [at("search_from_unknown", ...S(0, "query", "from"))],
  );
});

Deno.test("documents/contexts#R15 [ctx-I4]: follow uses a relation in its direction from a known alias", () => {
  assertEquals(
    issues(changed((b) => b.searches[0].query.follow[0].relation = "abut")),
    [at(
      "search_follow_relation_unknown",
      ...S(0, "query", "follow", 0, "relation"),
    )],
  );
  // reverse: Scenario를 가리키는 관계여야 한다. graded_by는 Rubric을 가리킨다.
  assertEquals(
    issues(
      changed((b) => b.searches[2].query.follow[0].relation = "graded_by"),
    ),
    [at(
      "search_follow_relation_unknown",
      ...S(2, "query", "follow", 0, "relation"),
    )],
  );
  assertEquals(
    issues(changed((b) => b.searches[0].query.follow[0].from = "x")),
    [at("search_follow_from_unknown", ...S(0, "query", "follow", 0, "from"))],
  );
  // 앞선 별칭에서 이어 따라간다: Finding → about(Experiment) → runs_on(Scenario)
  assertEquals(
    issues(changed((b) => {
      b.searches[0].query.follow.push({
        relation: "runs_on",
        as: "scn",
        from: "exp",
        direction: "forward",
      });
      b.searches[0].result.columns.push({
        label: "Scenario",
        path: "scn.title",
      });
    })),
    [],
  );
});

Deno.test("documents/contexts#R15 [ctx-I4]: every path names a field of the start type or of an alias", () => {
  assertEquals(
    issues(changed((b) => b.searches[0].query.where.path = "experimentt")),
    [at("search_path_unknown", ...S(0, "query", "where", "path"))],
  );
  assertEquals(
    issues(
      changed((b) => b.searches[0].result.columns[2].path = "exp.statuss"),
    ),
    [at("search_path_unknown", ...S(0, "result", "columns", 2, "path"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[0].result.columns[2].path = "ex.status")),
    [at("search_path_unknown", ...S(0, "result", "columns", 2, "path"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[0].query.sort[0].path = "rank")),
    [at("search_path_unknown", ...S(0, "query", "sort", 0, "path"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[1].result.board_by = "state")),
    [at("search_path_unknown", ...S(1, "result", "board_by"))],
  );
  assertEquals(
    issues(changed((b) => {
      b.searches[0].query.where = {
        all: [
          { path: "x", op: "exists" },
          { not: { path: "exp.y", op: "exists" } },
        ],
      };
    })),
    [
      at("search_path_unknown", ...S(0, "query", "where", "all", 0, "path")),
      at(
        "search_path_unknown",
        ...S(0, "query", "where", "all", 1, "not", "path"),
      ),
    ],
  );
  // key와 path는 모든 개체가 가진다. group도 path다.
  assertEquals(
    issues(changed((b) => {
      b.searches[1].query.group = { by: "path" };
      b.searches[1].query.sort = [{ path: "key", dir: "asc" }];
    })),
    [],
  );
});

Deno.test("documents/contexts#R14 [ctx-I4]: a search reads only public fields of another context", () => {
  const rubricColumn = (path: string) =>
    issues(changed((b) => {
      b.searches[1].query.follow = [{
        relation: "graded_by",
        as: "rub",
        direction: "forward",
      }];
      b.searches[1].result = {
        kind: "table",
        columns: [{ label: "Rubric", path }],
      };
    }));
  assertEquals(rubricColumn("rub.id"), []);
  assertEquals(rubricColumn("rub.weight"), [
    at("search_path_private", ...S(1, "result", "columns", 0, "path")),
  ]);
  assertEquals(rubricColumn("rub.nope"), [
    at("search_path_unknown", ...S(1, "result", "columns", 0, "path")),
  ]);
});

Deno.test("documents/contexts#R15 [ctx-I4]: inputs are declared and their of names a type or Type.field", () => {
  assertEquals(
    issues(changed((b) => b.searches[0].query.where.value = { input: "exp" })),
    [at("search_input_unknown", ...S(0, "query", "where", "value", "input"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[0].inputs[0].of = "Experimnt")),
    [at("search_input_of_unknown", ...S(0, "inputs", 0, "of"))],
  );
  // entity는 Type 이름, value·range는 Type.field
  assertEquals(
    issues(changed((b) => b.searches[0].inputs[0].of = "Experiment.status")),
    [at("search_input_of_unknown", ...S(0, "inputs", 0, "of"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[1].inputs[0].of = "Experiment")),
    [at("search_input_of_unknown", ...S(1, "inputs", 0, "of"))],
  );
  assertEquals(
    issues(changed((b) => b.searches[1].inputs[0].of = "Experiment.state")),
    [at("search_input_of_unknown", ...S(1, "inputs", 0, "of"))],
  );
  assertEquals(
    issues(changed((b) =>
      b.searches[1].inputs.push({
        name: "between",
        label: "Between",
        type: "range",
        of: "Experiment.title",
      })
    )),
    [at("search_input_of_not_range", ...S(1, "inputs", 1, "of"))],
  );
});

Deno.test("documents/contexts#R19 #R20 [ctx-I4]: examples call declared searches with declared inputs", () => {
  assertEquals(
    issues(changed((b) => b.examples[0].search = "nope")),
    [at("example_search_unknown", "examples", 0, "search")],
  );
  assertEquals(
    issues(changed((b) => b.examples[0].inputs = { exp: "008" })),
    [
      at("example_input_required", "examples", 0, "inputs"),
      at("example_input_unknown", "examples", 0, "inputs", "exp"),
    ],
  );
  assertEquals(
    issues(changed((b) => b.examples[1].expect.type = "Expt")),
    [at("example_type_unknown", "examples", 1, "expect", "type")],
  );
});

Deno.test("documents/contexts#R18 [ctx-I4]: saved views call declared searches with declared inputs", () => {
  assertEquals(
    issues(changed((b) => b.saved_views[0].search = "nope")),
    [at("saved_view_search_unknown", "saved_views", 0, "search")],
  );
  assertEquals(
    issues(changed((b) => b.saved_views[0].inputs = { state: ["running"] })),
    [at("saved_view_input_unknown", "saved_views", 0, "inputs", "state")],
  );
  assertEquals(
    issues(changed((b) =>
      b.saved_views.push({
        name: "Findings of nothing",
        search: "findings_for_experiment",
        inputs: {},
      })
    )),
    [at("saved_view_input_required", "saved_views", 1, "inputs")],
  );
});
