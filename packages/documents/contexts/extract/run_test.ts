import { assertEquals } from "@std/assert";
import { extractAll } from "./run.ts";
import {
  bundleOf,
  inlineFiles,
  loadAppData,
  loadContract,
  loadExpected,
  loadFixture,
  noAppData,
} from "./testing.ts";

const project = loadFixture("eval-project");
const bundle = loadContract("eval-project");
const expected = loadExpected("eval-project");
const fixtureRun = () =>
  extractAll(bundle, project, loadAppData("eval-project"));

Deno.test("documents/contexts#R6 [ctx-I15]: the eval-project fixture gives exactly the expected entities, in order", () => {
  assertEquals(fixtureRun().entities, expected.entities);
});

Deno.test("documents/contexts#R24 [ctx-I15]: the eval-project fixture gives exactly the expected extract violations, in order", () => {
  assertEquals(fixtureRun().violations, expected.violations);
});

Deno.test("documents/contexts#R6 [ctx-I15]: the same files and contract give the same result every time", () => {
  const first = fixtureRun();
  assertEquals(first.entities.length, expected.entities.length);
  assertEquals(fixtureRun(), first);
});

Deno.test("documents/contexts#R6 [ctx-I15]: entities follow the contract's type order even when a type reads another type declared after it", () => {
  // GuideHeading(outline, from_type Guide)를 Guide 앞에 둔다
  const types = bundle.contract.types;
  const guide = types.findIndex((type) => type.name === "Guide");
  const reordered = {
    ...bundle,
    contract: {
      types: [
        ...types.slice(0, guide),
        types[guide + 1],
        types[guide],
        ...types.slice(guide + 2),
      ],
    },
  };
  const result = extractAll(reordered, project, loadAppData("eval-project"));
  const of = (name: string) =>
    expected.entities.filter((entity) => entity.type === name);
  assertEquals(
    result.entities,
    [
      ...expected.entities.filter((entity) =>
        !["Guide", "GuideHeading", "Event"].includes(entity.type)
      ),
      ...of("GuideHeading"),
      ...of("Guide"),
      ...of("Event"),
    ],
  );
  assertEquals(result.violations, expected.violations);
});

Deno.test("documents/contexts#R12 [ctx-I15]: when the app returns no result the app-data type has no entities and the rest is unchanged", () => {
  const result = extractAll(bundle, project, noAppData());
  assertEquals(
    result.entities,
    expected.entities.filter((entity) => entity.type !== "Event"),
  );
  assertEquals(result.violations, expected.violations);
  assertEquals(
    expected.entities.some((entity) => entity.type === "Event"),
    true,
  );
});

const docsType = (
  name: string,
  paths: string[],
  fields: unknown[],
  relations: unknown[] = [],
) => ({
  name,
  summary: name,
  source: { kind: "docs", paths },
  key: "id",
  fields,
  relations,
});
const field = (
  name: string,
  from: unknown,
  value_type = "string",
  extra: object = {},
) => ({ name, from, value_type, ...extra });

Deno.test("documents/contexts#R6 [ctx-I15]: the key is the key field's value as text and fields are coerced to their value type", () => {
  const files = inlineFiles({ "x/a.md": "---\nid: 7\nn: 3\n---\n# A\n" });
  const result = extractAll(
    bundleOf([docsType("Doc", ["x/*.md"], [
      field("id", { kind: "frontmatter", key: "id" }),
      field("n", { kind: "frontmatter", key: "n" }, "number"),
      field("missing", { kind: "frontmatter", key: "missing" }),
    ])]),
    files,
    noAppData(),
  );
  assertEquals(result, {
    entities: [{
      type: "Doc",
      key: "7",
      path: "x/a.md",
      section: null,
      fields: { id: "7", n: 3, missing: null },
      links: [],
    }],
    violations: [],
  });
});

Deno.test("documents/contexts#R6 [ctx-I15]: links follow relation declaration order and via values in list order; a null via gives none and the target is not looked up", () => {
  const files = inlineFiles({
    "x/a.md": "---\nowner: bob\ntags: [y, x]\npeer: 5\n---\n",
  });
  const relation = (name: string, via: string) => ({
    name,
    label: name,
    to: "Doc",
    via,
    cardinality: "many",
  });
  const result = extractAll(
    bundleOf([docsType(
      "Doc",
      ["x/*.md"],
      [
        field("id", { kind: "path", capture: "file" }),
        field("owner", { kind: "frontmatter", key: "owner" }),
        field("tags", { kind: "frontmatter", key: "tags" }, "list", {
          item_type: "string",
        }),
        field("peer", { kind: "frontmatter", key: "peer" }),
        field("none", { kind: "frontmatter", key: "none" }),
      ],
      [
        relation("tagged", "tags"),
        relation("owned_by", "owner"),
        relation("nobody", "none"),
        relation("peer_of", "peer"),
      ],
    )]),
    files,
    noAppData(),
  );
  assertEquals(result.entities.map((entity) => entity.links), [[
    { relation: "tagged", target_key: "y" },
    { relation: "tagged", target_key: "x" },
    { relation: "owned_by", target_key: "bob" },
    // 숫자 via는 문자열 field 값("5")처럼 글로 쓴다
    { relation: "peer_of", target_key: "5" },
  ]]);
});

Deno.test("documents/contexts#R6 #R8 [ctx-I15]: a links field with to_type holds the keys of the linked entities of that type, so a relation can go through it", () => {
  const files = inlineFiles({
    "notes/n1.md":
      "---\nid: N1\n---\n# Note one\n[guide](../guides/g-a.md) [gone](../guides/g-x.md) [other](../misc.md)\n",
    "guides/g-a.md": "---\nslug: alpha\n---\n# Guide A\n",
    "misc.md": "# Misc\n",
  });
  const result = extractAll(
    bundleOf([
      docsType(
        "Note",
        ["notes/*.md"],
        [
          field("id", { kind: "frontmatter", key: "id" }),
          field("guides", { kind: "links", to_type: "Guide" }, "list", {
            item_type: "string",
          }),
          field("all_links", { kind: "links" }, "list", {
            item_type: "string",
          }),
        ],
        [{
          name: "reads",
          label: "reads",
          to: "Guide",
          via: "guides",
          cardinality: "many",
        }],
      ),
      docsType("Guide", ["guides/*.md"], [
        field("id", { kind: "frontmatter", key: "slug" }),
      ]),
    ]),
    files,
    noAppData(),
  );
  // field 읽기는 경로를 내고, run이 to_type 개체의 경로를 그 개체의 key로 바꾼다. 맞는 개체가 없는 링크는 빠진다.
  assertEquals(result.entities[0].fields, {
    id: "N1",
    guides: ["alpha"],
    all_links: ["guides/g-a.md", "guides/g-x.md", "misc.md"],
  });
  assertEquals(result.entities[0].links, [{
    relation: "reads",
    target_key: "alpha",
  }]);
});

Deno.test("documents/contexts#R24 [ctx-I15]: an unreadable file has no entity but its siblings still do", () => {
  const files = inlineFiles({
    "x/bad.md": "---\na: [b\n---\n# Bad\n",
    "x/good.md": "# Good\n",
  });
  const result = extractAll(
    bundleOf([docsType("Doc", ["x/*.md"], [
      field("id", { kind: "path", capture: "file" }),
    ])]),
    files,
    noAppData(),
  );
  assertEquals(result.entities.map((entity) => entity.key), ["good"]);
  assertEquals(result.violations, [{
    kind: "unreadable",
    rule: null,
    type: "Doc",
    path: "x/bad.md",
    section: null,
    target: null,
  }]);
});

Deno.test("documents/contexts#R24 [ctx-I15]: violations are ordered by path then kind and one file is reported once per kind", () => {
  const files = inlineFiles({
    "s/bad.md": "---\na: [b\n---\n",
    "s/n-1.md": "# One\n",
    "t/readme.md": "# T\n",
  });
  const id = field("id", { kind: "path", capture: "file" });
  const result = extractAll(
    bundleOf([
      docsType("A", ["s/*.md"], [id]),
      docsType("B", ["s/bad.md"], [id]),
      {
        name: "S",
        summary: "S",
        source: { kind: "series", pattern: "s/n-{n}.md" },
        key: "id",
        fields: [field("id", { kind: "path", capture: "n" })],
      },
      {
        name: "T",
        summary: "T",
        source: { kind: "series", pattern: "t/n-{n}.md" },
        key: "id",
        fields: [field("id", { kind: "path", capture: "n" })],
      },
    ]),
    files,
    noAppData(),
  );
  assertEquals(
    result.violations.map((v) => [v.path, v.kind, v.type]),
    [
      ["s/bad.md", "path_mismatch", "S"],
      // A와 B가 같은 파일을 읽을 수 없다고 해도 한 번만, 계약 순서로 앞선 type으로 센다
      ["s/bad.md", "unreadable", "A"],
      ["t/readme.md", "path_mismatch", "T"],
    ],
  );
  assertEquals(result.entities.map((e) => `${e.type}:${e.key}`), [
    "A:n-1",
    "S:1",
  ]);
});
