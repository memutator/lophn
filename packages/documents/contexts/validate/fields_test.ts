import { assertEquals } from "@std/assert";
import { checkFields } from "./fields.ts";
import { changed, sampleBundle, sampleEnv } from "./sample.ts";
import { type ContractIssue, sortIssues } from "./types.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";

const issues = (bundle: BundleContent): ContractIssue[] =>
  sortIssues(checkFields(bundle, sampleEnv()));
const at = (code: ContractIssue["code"], ...path: (string | number)[]) => ({
  code,
  path,
});
// types: 0 Experiment(series {n}) 1 Scenario(docs) 2 Finding(series {n}) 3 Decision(section)
//        4 Guide(index) 5 GuideHeading(outline) 6 Event(app-data)
const TYPE = (type: number, ...rest: (string | number)[]) =>
  ["contract", "types", type, ...rest] as const;
const text = (name: string, from: unknown) => ({
  name,
  from,
  value_type: "string",
});

Deno.test("documents/contexts#R6 [ctx-I2]: the sample contract has no field issues", () => {
  assertEquals(issues(sampleBundle()), []);
});

Deno.test("documents/contexts#R6 [ctx-I2]: the key is a scalar field of the type", () => {
  assertEquals(
    issues(changed((b) => b.contract.types[0].key = "nope")),
    [at("key_field_missing", ...TYPE(0, "key"))],
  );
  assertEquals(
    issues(changed((b) => b.contract.types[0].key = "scenarios")),
    [at("key_field_not_scalar", ...TYPE(0, "key"))],
  );
});

// 출처별로 허용하는 field 출처:
// folder: path, yaml(file 필수) / docs·series·index: frontmatter, yaml(file 없음), section, path, title,
// links, outline / section: path, title, section, links, outline / outline: path, title / app-data: item
Deno.test("documents/contexts#R6 #R7 [ctx-I2]: each source kind allows only some places to read a field from", () => {
  const addField = (type: number, from: unknown) =>
    issues(
      changed((b) => b.contract.types[type].fields.push(text("extra", from))),
    );
  const fieldPath = (type: number, index: number) =>
    TYPE(type, "fields", index, "from");
  // Event(app-data)에 frontmatter
  assertEquals(addField(6, { kind: "frontmatter", key: "x" }), [
    at("field_from_not_allowed", ...fieldPath(6, 2)),
  ]);
  // Experiment(series)에 item
  assertEquals(addField(0, { kind: "item", key_path: ["x"] }), [
    at("field_from_not_allowed", ...fieldPath(0, 6)),
  ]);
  // Decision(section)에 frontmatter
  assertEquals(addField(3, { kind: "frontmatter", key: "x" }), [
    at("field_from_not_allowed", ...fieldPath(3, 2)),
  ]);
  // GuideHeading(outline)에 section
  assertEquals(addField(5, { kind: "section", heading: "Intro" }), [
    at("field_from_not_allowed", ...fieldPath(5, 1)),
  ]);
  // Scenario(docs)에 file 있는 yaml
  assertEquals(
    addField(1, { kind: "yaml", file: "meta.yaml", key_path: ["x"] }),
    [at("field_from_not_allowed", ...fieldPath(1, 2))],
  );
  // 허용되는 것
  assertEquals(addField(1, { kind: "yaml", key_path: ["x"] }), []);
  assertEquals(addField(4, { kind: "links", within: "Guides" }), []);
  assertEquals(addField(3, { kind: "outline", max_level: 3 }), []);
  assertEquals(addField(6, { kind: "item", key_path: ["start", "date"] }), []);
});

Deno.test("documents/contexts#R7 [ctx-I2]: a folder type reads its folder name and YAML from a named file", () => {
  const folderScenario = (fields: unknown[]) =>
    issues(changed((b) => {
      b.contract.types[1].source = { kind: "folder", root: "eval/scenarios" };
      b.contract.types[1].fields = fields;
    }));
  assertEquals(
    folderScenario([
      text("id", { kind: "path", capture: "folder" }),
      text("goal", { kind: "yaml", file: "scenario.yaml", key_path: ["goal"] }),
    ]),
    [],
  );
  assertEquals(
    folderScenario([
      text("id", { kind: "path", capture: "folder" }),
      text("goal", { kind: "yaml", key_path: ["goal"] }),
    ]),
    [at("yaml_file_required", ...TYPE(1, "fields", 1, "from"))],
  );
  assertEquals(
    folderScenario([
      text("id", { kind: "path", capture: "file" }),
      text("title", { kind: "title" }),
    ]),
    [
      at("path_capture_unknown", ...TYPE(1, "fields", 0, "from", "capture")),
      at("field_from_not_allowed", ...TYPE(1, "fields", 1, "from")),
    ],
  );
});

// path capture: series는 pattern의 번호 자리 이름과 file·path, folder는 folder·path,
// docs·index·section·outline은 file·path
Deno.test("documents/contexts#R7 #R11 [ctx-I2]: path captures name what the source pattern captures", () => {
  const capture = (type: number, name: string) =>
    issues(changed((b) => {
      b.contract.types[type].fields[0].from = { kind: "path", capture: name };
    }));
  assertEquals(capture(2, "major"), [
    at("path_capture_unknown", ...TYPE(2, "fields", 0, "from", "capture")),
  ]);
  assertEquals(capture(1, "n"), [
    at("path_capture_unknown", ...TYPE(1, "fields", 0, "from", "capture")),
  ]);
  assertEquals(capture(2, "file"), []);
  assertEquals(capture(4, "path"), []);
  assertEquals(
    issues(changed((b) => {
      b.contract.types[2].source.pattern = "notes/{minor}.md";
      b.contract.types[2].fields[0].from = { kind: "path", capture: "minor" };
    })),
    [],
  );
});

Deno.test("documents/contexts#R6 [ctx-I2]: links name a type of the same contract", () => {
  const links = (toType: string) =>
    issues(changed((b) =>
      b.contract.types[0].fields.push({
        name: "papers",
        from: { kind: "links", to_type: toType },
        value_type: "list",
        item_type: "string",
      })
    ));
  assertEquals(links("Scenario"), []);
  assertEquals(links("Paper"), [
    at("links_type_unknown", ...TYPE(0, "fields", 6, "from", "to_type")),
  ]);
});

Deno.test("documents/contexts#R14 [ctx-I2]: a private type has no public fields", () => {
  assertEquals(
    issues(changed((b) => b.contract.types[2].fields[0].visibility = "public")),
    [at(
      "field_visibility_wider_than_type",
      ...TYPE(2, "fields", 0, "visibility"),
    )],
  );
  assertEquals(
    issues(changed((b) => b.contract.types[0].fields[1].visibility = "public")),
    [],
  );
});

Deno.test("documents/contexts#R13 [ctx-I2]: rules point at fields of their type and fit the field", () => {
  const rule = (r: unknown) =>
    issues(changed((b) => b.contract.types[0].rules.push(r)));
  const base = { id: "extra", message: "Extra rule" };
  const RULE = (...rest: (string | number)[]) =>
    TYPE(0, "rules", 3, "params", ...rest);
  assertEquals(
    rule({ ...base, kind: "required_field", params: { field: "owner" } }),
    [at("rule_field_unknown", ...RULE("field"))],
  );
  assertEquals(
    rule({
      ...base,
      kind: "unique_key",
      params: { fields: ["title", "nope"] },
    }),
    [at("rule_field_unknown", ...RULE("fields", 1))],
  );
  assertEquals(
    rule({ ...base, kind: "enum_value", params: { field: "title" } }),
    [at("rule_field_not_enum", ...RULE("field"))],
  );
  assertEquals(
    rule({ ...base, kind: "pattern", params: { field: "nope", regex: "^x" } }),
    [at("rule_field_unknown", ...RULE("field"))],
  );
  assertEquals(
    rule({ ...base, kind: "count_range", params: { field: "title", min: 1 } }),
    [at("rule_field_not_list", ...RULE("field"))],
  );
  assertEquals(
    rule({
      ...base,
      kind: "count_range",
      params: { field: "scenarios", min: 1 },
    }),
    [],
  );
  assertEquals(
    rule({ ...base, kind: "count_range", params: { max: 500 } }),
    [],
  );
  // relation 규칙은 relations 검사의 몫이다.
  assertEquals(
    rule({
      ...base,
      kind: "relation_target_exists",
      params: { relation: "nope" },
    }),
    [],
  );
});
