import { assertEquals } from "@std/assert";
import {
  documentAnchor,
  fieldContext,
  fieldOf,
  inlineFiles,
  loadFixture,
} from "../testing.ts";
import {
  coerceFieldValue,
  frontmatterField,
  yamlField,
} from "./frontmatter.ts";

const project = loadFixture("eval-project");
const experiment = (path: string) =>
  fieldContext(project, documentAnchor("Experiment", path));
const frontmatter = (key: string) => ({ kind: "frontmatter" as const, key });

Deno.test("documents/contexts#R6 [ctx-I12]: a frontmatter key gives its value as written", () => {
  const context = experiment("eval/experiments/exp-001-plan.md");
  assertEquals(frontmatterField(frontmatter("status"), context), "done");
  assertEquals(frontmatterField(frontmatter("scenarios"), context), [
    "schedule-basic",
  ]);
});

Deno.test("documents/contexts#R6 [ctx-I12]: a missing key is null but an empty list is []", () => {
  const paused = experiment("eval/experiments/exp-003-paused.md");
  assertEquals(frontmatterField(frontmatter("scenarios"), paused), []);
  assertEquals(frontmatterField(frontmatter("rubric"), paused), null);
  // frontmatter가 아예 없는 문서도 null
  const scenario = fieldContext(
    project,
    documentAnchor("Scenario", "eval/scenarios/travel.md"),
  );
  assertEquals(frontmatterField(frontmatter("status"), scenario), null);
  assertEquals(frontmatterField(frontmatter("status"), paused), "paused");
});

Deno.test("documents/contexts#R6 [ctx-I12]: a key with a YAML null value is null", () => {
  const files = inlineFiles({ "a.md": "---\nrubric:\n---\n# A\n" });
  const context = fieldContext(files, documentAnchor("T", "a.md"));
  assertEquals(frontmatterField(frontmatter("rubric"), context), null);
  assertEquals(frontmatterField(frontmatter("other"), context), null);
  assertEquals(context.document?.headings.length, 1);
});

const yamlFiles = inlineFiles({
  "conf/app.yaml": "a:\n  b: x\n  list: [1, 2]\nempty: []\n",
  "runs/run-1/result.yaml": "score: 3\nnested:\n  ok: true\n",
});

Deno.test("documents/contexts#R6 [ctx-I12]: a yaml field without file reads the entity document's own YAML by key path", () => {
  const context = fieldContext(
    yamlFiles,
    documentAnchor("Conf", "conf/app.yaml"),
  );
  const from = (...key_path: string[]) => ({ kind: "yaml" as const, key_path });
  assertEquals(yamlField(from("a", "b"), context), "x");
  assertEquals(yamlField(from("a", "list"), context), [1, 2]);
  assertEquals(yamlField(from("empty"), context), []);
  assertEquals(yamlField(from("a", "missing"), context), null);
  // 객체가 아닌 값 아래로는 내려갈 수 없다
  assertEquals(yamlField(from("a", "b", "c"), context), null);
});

Deno.test("documents/contexts#R6 [ctx-I12]: a yaml field with file reads that file under the entity folder", () => {
  const context = fieldContext(yamlFiles, {
    type: "Run",
    path: "runs/run-1",
    section: null,
    captures: { folder: "run-1" },
    scope: { kind: "folder" },
  });
  const from = (file: string, ...key_path: string[]) => ({
    kind: "yaml" as const,
    file,
    key_path,
  });
  assertEquals(yamlField(from("result.yaml", "score"), context), 3);
  assertEquals(yamlField(from("result.yaml", "nested", "ok"), context), true);
  assertEquals(yamlField(from("missing.yaml", "score"), context), null);
});

Deno.test("documents/contexts#R6 [ctx-I12]: a string field turns YAML scalars into their written text", () => {
  const files = inlineFiles({
    "a.md":
      '---\ndue: 2025-03-01\ncount: 3\nratio: 1.5\nflag: true\nquoted: "007"\nname: plain\n---\n',
  });
  const context = fieldContext(files, documentAnchor("T", "a.md"));
  const string = fieldOf("v", "string");
  const text = (key: string) =>
    coerceFieldValue(string, frontmatterField(frontmatter(key), context));
  assertEquals(
    ["due", "count", "ratio", "flag", "quoted", "name"].map(text),
    ["2025-03-01", "3", "1.5", "true", "007", "plain"],
  );
});

Deno.test("documents/contexts#R6 [ctx-I12]: a missing value stays null and other value types keep their value", () => {
  assertEquals(coerceFieldValue(fieldOf("v", "string"), null), null);
  assertEquals(coerceFieldValue(fieldOf("v", "number"), 3), 3);
  assertEquals(coerceFieldValue(fieldOf("v", "boolean"), false), false);
  assertEquals(
    coerceFieldValue(fieldOf("v", "date"), "2025-03-01"),
    "2025-03-01",
  );
  // enum은 허용 값 밖이어도 그대로 싣는다(검사가 위반으로 센다)
  const status = fieldOf("v", "enum", { values: ["planned", "running"] });
  assertEquals(coerceFieldValue(status, "paused"), "paused");
});

Deno.test("documents/contexts#R6 [ctx-I12]: a list field coerces each item by item_type and keeps [] and null apart", () => {
  const strings = fieldOf("v", "list", { item_type: "string" });
  assertEquals(coerceFieldValue(strings, [1, "a", true]), ["1", "a", "true"]);
  assertEquals(coerceFieldValue(strings, []), []);
  assertEquals(coerceFieldValue(strings, null), null);
  const numbers = fieldOf("v", "list", { item_type: "number" });
  assertEquals(coerceFieldValue(numbers, [1, 2]), [1, 2]);
});
