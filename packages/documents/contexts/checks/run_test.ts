import { assertEquals } from "@std/assert";
import {
  bundleContentSchema,
  type Contract,
  contractSchema,
} from "../../../protocol/projects/mod.ts";
import { checkEntities } from "./run.ts";
import type {
  CheckEntity,
  CheckFieldValue,
  ExternalKeys,
  RuleViolation,
} from "./types.ts";

// ---------- helpers ----------

const readJson = (name: string): unknown =>
  JSON.parse(
    Deno.readTextFileSync(new URL(`../testdata/${name}`, import.meta.url)),
  );

const noExternal: ExternalKeys = () => undefined;

// 시험용 type 하나. fields에 key field `id`를 항상 더한다.
interface TypeSpec {
  fields?: Record<string, unknown>[];
  relations?: Record<string, unknown>[];
  rules: Record<string, unknown>[];
}
const field = (
  name: string,
  value_type: string,
  extra: Record<string, unknown> = {},
) => ({
  name,
  from: { kind: "frontmatter", key: name },
  value_type,
  ...extra,
});
const rule = (id: string, kind: string, params: Record<string, unknown>) => ({
  id,
  message: `rule ${id}`,
  kind,
  params,
});
const relation = (name: string, to: string, via: string) => ({
  name,
  label: name,
  to,
  via,
  cardinality: "many",
});
const contractOf = (types: Record<string, TypeSpec>): Contract =>
  contractSchema.parse({
    types: Object.entries(types).map(([name, spec]) => ({
      name,
      summary: `type ${name}`,
      source: { kind: "docs", paths: ["x/*.md"] },
      key: "id",
      fields: [field("id", "string"), ...(spec.fields ?? [])],
      relations: spec.relations ?? [],
      rules: spec.rules,
    })),
  });

const entity = (
  type: string,
  key: string,
  fields: Record<string, CheckFieldValue> = {},
  more: Partial<CheckEntity> = {},
): CheckEntity => ({
  type,
  key,
  path: `x/${key}.md`,
  section: null,
  fields: { id: key, ...fields },
  links: [],
  ...more,
});
const violation = (
  rule: string,
  path: string,
  target: string | null = null,
  section: string | null = null,
): RuleViolation => ({
  kind: "rule",
  rule,
  type: rule.split(".")[0],
  path,
  section,
  target,
});

// ---------- fixture ----------

Deno.test("documents/contexts#R13 [ctx-I16]: the eval-project entities give exactly the expected rule violations", () => {
  const contract =
    bundleContentSchema.parse(readJson("eval-project.contract.json")).contract;
  const entities = readJson(
    "expected/eval-project.entities.json",
  ) as CheckEntity[];
  const expected = readJson("expected/eval-project.rule-violations.json");
  assertEquals(checkEntities(contract, entities, noExternal), expected);
});

// ---------- required_field ----------

Deno.test("documents/contexts#R13 [ctx-I16]: required_field reports null and missing values but treats an empty string and an empty list as present", () => {
  const contract = contractOf({
    Doc: {
      fields: [
        field("status", "string"),
        field("tags", "list", {
          item_type: "string",
        }),
      ],
      rules: [
        rule("status-required", "required_field", { field: "status" }),
        rule("tags-required", "required_field", { field: "tags" }),
      ],
    },
  });
  const entities = [
    entity("Doc", "a", { status: null, tags: null }),
    entity("Doc", "b", {}),
    entity("Doc", "c", { status: "", tags: [] }),
    entity("Doc", "d", { status: "open", tags: ["t"] }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.status-required", "x/a.md"),
    violation("Doc.tags-required", "x/a.md"),
    violation("Doc.status-required", "x/b.md"),
    violation("Doc.tags-required", "x/b.md"),
  ]);
});

// ---------- unique_key ----------

Deno.test("documents/contexts#R13 [ctx-I16]: unique_key keeps the first entity in input order and reports every later one with the same key", () => {
  const contract = contractOf({
    Doc: { rules: [rule("key-unique", "unique_key", {})] },
    Other: { rules: [] },
  });
  const entities = [
    entity("Doc", "k", {}, { path: "x/z.md" }),
    entity("Doc", "k", {}, { path: "x/a.md" }),
    entity("Doc", "j", {}, { path: "x/j.md" }),
    entity("Doc", "k", {}, { path: "x/m.md" }),
    entity("Other", "k", {}, { path: "x/other.md" }),
  ];
  // z.md는 입력에서 먼저라 남고, a.md와 m.md가 위반이다.
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.key-unique", "x/a.md"),
    violation("Doc.key-unique", "x/m.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: unique_key with fields compares the tuple of those field values and ignores the key", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("team", "string"), field("slug", "string")],
      rules: [rule("slug-unique", "unique_key", { fields: ["team", "slug"] })],
    },
  });
  const entities = [
    entity("Doc", "1", { team: "x", slug: "a" }),
    entity("Doc", "2", { team: "x", slug: "b" }),
    entity("Doc", "3", { team: "y", slug: "a" }),
    entity("Doc", "4", { team: "x", slug: "a" }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.slug-unique", "x/4.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: unique_key with fields skips entities whose listed field is null", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("team", "string"), field("slug", "string")],
      rules: [rule("slug-unique", "unique_key", { fields: ["team", "slug"] })],
    },
  });
  const entities = [
    entity("Doc", "1", { team: null, slug: "a" }),
    entity("Doc", "2", { team: null, slug: "a" }),
    entity("Doc", "3", { team: "x", slug: "a" }),
    entity("Doc", "4", { team: "x", slug: "a" }),
  ];
  // null이 든 1·2는 서로 같다고 세지 않는다. 3·4만 겹친다.
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.slug-unique", "x/4.md"),
  ]);
});

// ---------- relation_target_exists ----------

Deno.test("documents/contexts#R13 [ctx-I16]: relation_target_exists reports a missing key of a local type with the target", () => {
  const contract = contractOf({
    Task: {
      fields: [field("parent", "string")],
      relations: [relation("parent_of", "Epic", "parent")],
      rules: [rule("parent-exists", "relation_target_exists", {
        relation: "parent_of",
      })],
    },
    Epic: { rules: [] },
    Note: { rules: [] },
  });
  const entities = [
    entity("Epic", "e1"),
    // Note의 key는 Epic의 key로 세지 않는다.
    entity("Note", "n1"),
    entity("Task", "t1", { parent: "e1" }, {
      links: [{ relation: "parent_of", target_key: "e1" }],
    }),
    entity("Task", "t2", { parent: "n1" }, {
      links: [{ relation: "parent_of", target_key: "n1" }],
    }),
    entity("Task", "t3", { parent: null }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Task.parent-exists", "x/t2.md", "n1"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: relation_target_exists over a list via reports one violation per missing key in link order and ignores other relations", () => {
  const contract = contractOf({
    Run: {
      fields: [field("scenarios", "list", { item_type: "string" })],
      relations: [
        relation("runs_on", "Scenario", "scenarios"),
        relation("other", "Scenario", "scenarios"),
      ],
      rules: [rule("scenarios-exist", "relation_target_exists", {
        relation: "runs_on",
      })],
    },
    Scenario: { rules: [] },
  });
  const entities = [
    entity("Scenario", "s1"),
    entity("Run", "r1", { scenarios: ["zz", "s1", "aa"] }, {
      links: [
        { relation: "runs_on", target_key: "zz" },
        { relation: "runs_on", target_key: "s1" },
        { relation: "runs_on", target_key: "aa" },
        { relation: "other", target_key: "nope" },
      ],
    }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Run.scenarios-exist", "x/r1.md", "zz"),
    violation("Run.scenarios-exist", "x/r1.md", "aa"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: relation_target_exists asks externalKeys for context/Type targets and reports a key the other context lacks", () => {
  const contract = contractOf({
    Experiment: {
      fields: [field("rubric", "string")],
      relations: [relation("graded_by", "rubrics/Rubric", "rubric")],
      rules: [rule("rubric-exists", "relation_target_exists", {
        relation: "graded_by",
      })],
    },
  });
  const entities = [
    entity("Experiment", "a", { rubric: "quality" }, {
      links: [{ relation: "graded_by", target_key: "quality" }],
    }),
    entity("Experiment", "b", { rubric: "ghost" }, {
      links: [{ relation: "graded_by", target_key: "ghost" }],
    }),
  ];
  const asked: string[] = [];
  const externalKeys: ExternalKeys = (context, type) => {
    asked.push(`${context}/${type}`);
    return new Set(["quality"]);
  };
  assertEquals(checkEntities(contract, entities, externalKeys), [
    violation("Experiment.rubric-exists", "x/b.md", "ghost"),
  ]);
  assertEquals(new Set(asked), new Set(["rubrics/Rubric"]));
});

Deno.test("documents/contexts#R13 [ctx-I16]: relation_target_exists reports nothing for an external target whose context is not loaded", () => {
  const contract = contractOf({
    Experiment: {
      fields: [field("rubric", "string"), field("status", "string")],
      relations: [relation("graded_by", "rubrics/Rubric", "rubric")],
      rules: [
        rule("rubric-exists", "relation_target_exists", {
          relation: "graded_by",
        }),
        rule("status-required", "required_field", { field: "status" }),
      ],
    },
  });
  const entities = [
    entity("Experiment", "a", { rubric: "ghost", status: null }, {
      links: [{ relation: "graded_by", target_key: "ghost" }],
    }),
  ];
  // 다른 규칙은 그대로 돌고(status-required가 나옴) 외부 관계만 조용하다.
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Experiment.status-required", "x/a.md"),
  ]);
});

// ---------- enum_value ----------

Deno.test("documents/contexts#R13 [ctx-I16]: enum_value reports a value outside the allowed values and skips null and missing", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("status", "enum", { values: ["planned", "done"] })],
      rules: [rule("status-known", "enum_value", { field: "status" })],
    },
  });
  const entities = [
    entity("Doc", "a", { status: "done" }),
    entity("Doc", "b", { status: "paused" }),
    entity("Doc", "c", { status: null }),
    entity("Doc", "d", {}),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.status-known", "x/b.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: enum_value over a list checks each item and reports the entity once however many items are outside", () => {
  const contract = contractOf({
    Doc: {
      fields: [
        field("tags", "list", { item_type: "enum", values: ["x", "y"] }),
      ],
      rules: [rule("tags-known", "enum_value", { field: "tags" })],
    },
  });
  const entities = [
    entity("Doc", "a", { tags: ["x", "y"] }),
    entity("Doc", "b", { tags: ["x", "q", "r"] }),
    entity("Doc", "c", { tags: [] }),
    entity("Doc", "d", { tags: null }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.tags-known", "x/b.md"),
  ]);
});

// ---------- pattern ----------

Deno.test("documents/contexts#R13 [ctx-I16]: pattern reports a value the regex does not match and skips null and missing", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("slug", "string")],
      rules: [rule("slug-shape", "pattern", {
        field: "slug",
        regex: "^[a-z]+$",
      })],
    },
  });
  const entities = [
    entity("Doc", "a", { slug: "abc" }),
    entity("Doc", "b", { slug: "ABC" }),
    entity("Doc", "c", { slug: null }),
    entity("Doc", "d", {}),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.slug-shape", "x/b.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: pattern over a list checks each item and reports the entity once", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("slugs", "list", { item_type: "string" })],
      rules: [rule("slugs-shape", "pattern", {
        field: "slugs",
        regex: "^[a-z]+$",
      })],
    },
  });
  const entities = [
    entity("Doc", "a", { slugs: ["ok", "fine"] }),
    entity("Doc", "b", { slugs: ["ok", "BAD", "WORSE"] }),
    entity("Doc", "c", { slugs: [] }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.slugs-shape", "x/b.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: pattern uses the u flag and searches the value instead of requiring a full match", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("a", "string"), field("b", "string")],
      rules: [
        // u flag: `.` is one code point, so a single emoji matches `^.$`
        rule("a-one-char", "pattern", { field: "a", regex: "^.$" }),
        // not anchored: matches anywhere in the value
        rule("b-has-abc", "pattern", { field: "b", regex: "abc" }),
      ],
    },
  });
  const entities = [
    entity("Doc", "ok", { a: "\u{1F600}", b: "xxabcxx" }),
    entity("Doc", "bad", { a: "ab", b: "xxabxx" }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.a-one-char", "x/bad.md"),
    violation("Doc.b-has-abc", "x/bad.md"),
  ]);
});

// ---------- count_range ----------

Deno.test("documents/contexts#R13 [ctx-I16]: count_range with a field checks the list length and counts a null list as length 0", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("tags", "list", { item_type: "string" })],
      rules: [rule("tags-count", "count_range", {
        field: "tags",
        min: 1,
        max: 2,
      })],
    },
  });
  const entities = [
    entity("Doc", "a", { tags: [] }),
    entity("Doc", "b", { tags: ["t"] }),
    entity("Doc", "c", { tags: ["t", "u"] }),
    entity("Doc", "d", { tags: ["t", "u", "v"] }),
    entity("Doc", "e", { tags: null }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [
    violation("Doc.tags-count", "x/a.md"),
    violation("Doc.tags-count", "x/d.md"),
    violation("Doc.tags-count", "x/e.md"),
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: count_range without a field counts the entities of the type and reports on the first entity of the type in input order", () => {
  const contract = contractOf({
    Doc: {
      rules: [rule("doc-count", "count_range", { min: 1, max: 3 })],
    },
    Other: { rules: [] },
  });
  const many = [
    entity("Other", "o"),
    entity("Doc", "z", {}, { path: "x/z.md" }),
    entity("Doc", "b"),
    entity("Doc", "c"),
    entity("Doc", "a", {}, { path: "x/a.md" }),
  ];
  // 개체 4개 > max 3. 입력에서 Doc의 첫 개체(z.md)에 하나만 붙는다.
  assertEquals(checkEntities(contract, many, noExternal), [
    violation("Doc.doc-count", "x/z.md"),
  ]);
  // 범위 안이면 위반이 없고, Other 개체는 세지 않는다.
  assertEquals(checkEntities(contract, many.slice(0, 4), noExternal), []);
  const tooFew = contractOf({
    Doc: { rules: [rule("doc-count", "count_range", { min: 2 })] },
  });
  assertEquals(
    checkEntities(tooFew, [entity("Doc", "only")], noExternal),
    [violation("Doc.doc-count", "x/only.md")],
  );
});

Deno.test("documents/contexts#R13 [ctx-I16]: count_range without a field reports nothing when the type has no entity because no file carries the violation", () => {
  const contract = contractOf({
    Doc: { rules: [rule("doc-count", "count_range", { min: 1 })] },
    Other: {
      fields: [field("x", "string")],
      rules: [rule("x-required", "required_field", { field: "x" })],
    },
  });
  // Doc 개체가 없으므로 doc-count는 조용하다. Other의 규칙은 그대로 돈다.
  assertEquals(
    checkEntities(contract, [entity("Other", "o", { x: null })], noExternal),
    [violation("Other.x-required", "x/o.md")],
  );
  assertEquals(checkEntities(contract, [], noExternal), []);
});

// ---------- evidence, order, determinism ----------

Deno.test("documents/contexts#R24 [ctx-I16]: a violation carries the entity's path, section, type and Type.rule-id", () => {
  const contract = contractOf({
    Decision: {
      fields: [field("why", "string")],
      rules: [rule("why-required", "required_field", { field: "why" })],
    },
  });
  const entities = [
    entity("Decision", "Use SQLite", { why: null }, {
      path: "docs/decisions.md",
      section: "Use SQLite",
    }),
  ];
  assertEquals(checkEntities(contract, entities, noExternal), [{
    kind: "rule",
    rule: "Decision.why-required",
    type: "Decision",
    path: "docs/decisions.md",
    section: "Use SQLite",
    target: null,
  }]);
});

Deno.test("documents/contexts#R24 [ctx-I16]: violations are ordered by path, rule, section in code unit order, null section first", () => {
  const contract = contractOf({
    Doc: {
      fields: [field("a", "string"), field("b", "string")],
      rules: [
        rule("b-required", "required_field", { field: "b" }),
        rule("a-required", "required_field", { field: "a" }),
      ],
    },
  });
  const bare = (
    key: string,
    path: string,
    section: string | null,
  ) => entity("Doc", key, { a: null, b: null }, { path, section });
  // 일부러 섞은 입력 순서
  const entities = [
    bare("1", "x/m.md", "B"),
    bare("2", "x/a.md", null),
    bare("3", "x/m.md", "A"),
    bare("4", "x/B.md", null),
    bare("5", "x/m.md", null),
    bare("6", "x/10.md", null),
    bare("7", "x/2.md", null),
  ];
  const result = checkEntities(contract, entities, noExternal);
  const order = result.map((v) => `${v.path}|${v.rule}|${v.section}`);
  assertEquals(order, [
    // 숫자 순이 아니라 code unit 순: "10" < "2", 대문자 < 소문자
    "x/10.md|Doc.a-required|null",
    "x/10.md|Doc.b-required|null",
    "x/2.md|Doc.a-required|null",
    "x/2.md|Doc.b-required|null",
    "x/B.md|Doc.a-required|null",
    "x/B.md|Doc.b-required|null",
    "x/a.md|Doc.a-required|null",
    "x/a.md|Doc.b-required|null",
    "x/m.md|Doc.a-required|null",
    "x/m.md|Doc.a-required|A",
    "x/m.md|Doc.a-required|B",
    "x/m.md|Doc.b-required|null",
    "x/m.md|Doc.b-required|A",
    "x/m.md|Doc.b-required|B",
  ]);
});

Deno.test("documents/contexts#R13 [ctx-I16]: the same input twice gives the same output and the input is left unchanged", () => {
  const contract = bundleContentSchema.parse(
    readJson("eval-project.contract.json"),
  ).contract;
  const entities = readJson(
    "expected/eval-project.entities.json",
  ) as CheckEntity[];
  const before = JSON.stringify(entities);
  const first = checkEntities(contract, entities, noExternal);
  const second = checkEntities(contract, entities, noExternal);
  assertEquals(first, second);
  assertEquals(JSON.stringify(entities), before);
  // 빈 결과끼리 같은 것으로 통과하지 않도록 기대한 위반 수를 함께 본다.
  assertEquals(first.length, 4);
  // 입력 순서를 뒤집어도 위반 집합과 순서가 같다(unique_key·count_range 규칙이 없는 fixture).
  assertEquals(
    checkEntities(contract, [...entities].reverse(), noExternal),
    first,
  );
});
