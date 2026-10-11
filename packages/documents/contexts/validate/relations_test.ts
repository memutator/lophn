import { assertEquals } from "@std/assert";
import { checkRelations } from "./relations.ts";
import { changed, sampleBundle, sampleEnv } from "./sample.ts";
import { type ContractIssue, sortIssues } from "./types.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";

const issues = (bundle: BundleContent): ContractIssue[] =>
  sortIssues(checkRelations(bundle, sampleEnv()));
const at = (code: ContractIssue["code"], ...path: (string | number)[]) => ({
  code,
  path,
});
// Experiment(0).relations: 0 runs_on → Scenario many via scenarios(list)
//                          1 graded_by → rubrics/Rubric optional via rubric
// Finding(2, private).relations: 0 about → Experiment one via experiment
const REL = (type: number, index: number, key: string) =>
  ["contract", "types", type, "relations", index, key] as const;

Deno.test("documents/contexts#R6 [ctx-I3]: the sample contract has no relation issues", () => {
  assertEquals(issues(sampleBundle()), []);
});

Deno.test("documents/contexts#R6 [ctx-I3]: a relation points at a type of the same contract", () => {
  assertEquals(
    issues(changed((b) => b.contract.types[2].relations[0].to = "Experment")),
    [at("relation_target_unknown", ...REL(2, 0, "to"))],
  );
});

Deno.test("documents/contexts#R14 [ctx-I3]: another context is reached only through its public types", () => {
  const graded = (to: string) =>
    issues(changed((b) => b.contract.types[0].relations[1].to = to));
  assertEquals(graded("rubrics/Rubric"), []);
  assertEquals(graded("rubrics/Score"), [
    at("relation_target_unknown", ...REL(0, 1, "to")),
  ]);
  assertEquals(graded("grading/Rubric"), [
    at("relation_target_unknown", ...REL(0, 1, "to")),
  ]);
  assertEquals(graded("rubrics/Draft"), [
    at("relation_target_private", ...REL(0, 1, "to")),
  ]);
});

Deno.test("documents/contexts#R6 [ctx-I3]: via is a field of the type and its shape fits the cardinality", () => {
  assertEquals(
    issues(changed((b) => b.contract.types[2].relations[0].via = "exp")),
    [at("relation_via_unknown", ...REL(2, 0, "via"))],
  );
  // many는 list field, one·optional은 list가 아닌 field
  assertEquals(
    issues(
      changed((b) => b.contract.types[0].relations[0].cardinality = "one"),
    ),
    [at("relation_via_mismatch", ...REL(0, 0, "cardinality"))],
  );
  assertEquals(
    issues(
      changed((b) => b.contract.types[2].relations[0].cardinality = "many"),
    ),
    [at("relation_via_mismatch", ...REL(2, 0, "cardinality"))],
  );
  assertEquals(
    issues(
      changed((b) => b.contract.types[2].relations[0].cardinality = "optional"),
    ),
    [],
  );
});

Deno.test("documents/contexts#R14 [ctx-I3]: a private type has no public relations", () => {
  assertEquals(
    issues(
      changed((b) => b.contract.types[2].relations[0].visibility = "public"),
    ),
    [at("relation_visibility_wider_than_type", ...REL(2, 0, "visibility"))],
  );
});

Deno.test("documents/contexts#R13 [ctx-I3]: relation_target_exists names a relation of its type", () => {
  assertEquals(
    issues(changed((b) => {
      b.contract.types[2].rules[0].params.relation = "aboutt";
    })),
    [at(
      "rule_relation_unknown",
      "contract",
      "types",
      2,
      "rules",
      0,
      "params",
      "relation",
    )],
  );
  // field 규칙은 fields 검사의 몫이다.
  assertEquals(
    issues(changed((b) => {
      b.contract.types[0].rules[0].params.field = "owner";
    })),
    [],
  );
});
