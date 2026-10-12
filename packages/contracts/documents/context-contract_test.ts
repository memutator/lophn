import { assert, assertEquals } from "@std/assert";
import {
  bundleContentSchema,
  CONTEXT_SOURCE_KINDS,
  contractSourceSchema,
  contractTypeSchema,
  declaredSearchSchema,
  resultViewSchema,
  splitExternalRef,
} from "./context-contract.ts";

const field = (name: string, from: unknown, extra: object = {}) => ({
  name,
  from,
  value_type: "string",
  ...extra,
});

const experiment = {
  name: "Experiment",
  summary: "One run comparing arms on scenarios",
  visibility: "public",
  source: { kind: "series", pattern: "eval/experiments/exp-{n:03}-*.md" },
  key: "id",
  fields: [
    field("id", { kind: "path", capture: "n" }),
    field("status", { kind: "frontmatter", key: "status" }, {
      value_type: "enum",
      values: ["planned", "running", "done"],
    }),
    field("scenarios", { kind: "frontmatter", key: "scenarios" }, {
      value_type: "list",
      item_type: "string",
    }),
    field("question", { kind: "section", heading: "질문" }),
  ],
  relations: [{
    name: "runs_on",
    label: "runs on",
    to: "Scenario",
    via: "scenarios",
    cardinality: "many",
  }],
  rules: [{
    id: "status-required",
    kind: "required_field",
    params: { field: "status" },
    message: "Every experiment says its status",
  }],
};

const sourceSamples: Record<string, unknown> = {
  folder: { kind: "folder", root: "eval/scenarios" },
  docs: { kind: "docs", paths: ["docs/*.md"] },
  series: { kind: "series", pattern: "loop/findings/F-{n:03}.md" },
  index: { kind: "index", document: "docs/README.md" },
  section: { kind: "section", documents: ["docs/decisions.md"], level: 2 },
  outline: { kind: "outline", from_type: "Guide", format: "markdown" },
  "app-data": {
    kind: "app-data",
    app: "calendar",
    command: "events.list",
    result_path: ["items"],
  },
};

Deno.test("documents/contexts#R5 [ctx-S10]: the source kinds are exactly the seven", () => {
  assertEquals([...CONTEXT_SOURCE_KINDS], [
    "folder",
    "docs",
    "series",
    "index",
    "section",
    "outline",
    "app-data",
  ]);
  for (const kind of CONTEXT_SOURCE_KINDS) {
    assert(
      contractSourceSchema.safeParse(sourceSamples[kind]).success,
      `${kind} sample is accepted`,
    );
  }
  for (
    const rejected of [
      { kind: "registry", file: "components.yaml" },
      { paths: ["docs/*.md"] },
      { kind: "docs", paths: [] },
      { kind: "docs", paths: ["../other/*.md"] },
      { kind: "docs", paths: ["/abs/*.md"] },
      { kind: "docs", paths: ["docs/*.md"], pattern: "x" },
      { kind: "section", level: 2 },
      {
        kind: "section",
        documents: ["a.md"],
        from_type: "Guide",
        level: 2,
      },
      { kind: "section", documents: ["a.md"], level: 7 },
      { kind: "outline", documents: ["a.md"], format: "pdf" },
      {
        kind: "outline",
        documents: ["a.md"],
        format: "markdown",
        min_level: 4,
        max_level: 2,
      },
      { kind: "app-data", app: "Calendar", command: "x", result_path: [] },
    ]
  ) {
    assert(
      !contractSourceSchema.safeParse(rejected).success,
      JSON.stringify(rejected),
    );
  }
});

Deno.test("documents/contexts#R6 [ctx-S10]: fields take one source of value and a value type", () => {
  assert(contractTypeSchema.safeParse(experiment).success);
  const parsed = contractTypeSchema.parse(experiment);
  assertEquals(parsed.fields[0].required, false);
  assertEquals(parsed.fields[0].visibility, "private");
  assertEquals(
    parsed.fields.map((f) => f.from.kind),
    ["path", "frontmatter", "frontmatter", "section"],
  );
  const withField = (f: unknown) =>
    contractTypeSchema.safeParse({
      ...experiment,
      fields: [experiment.fields[0], f],
    }).success;
  assert(
    !withField(field("status", { kind: "frontmatter", key: "s" }, {
      value_type: "enum",
    })),
  );
  assert(
    !withField(field("tags", { kind: "frontmatter", key: "t" }, {
      value_type: "list",
    })),
  );
  assert(
    !withField(field("tags", { kind: "frontmatter", key: "t" }, {
      value_type: "string",
      item_type: "string",
    })),
  );
  assert(!withField(field("Status", { kind: "frontmatter", key: "s" })));
  assert(!withField(field("when", { kind: "clock" })));
  assert(withField(field("labels", { kind: "frontmatter", key: "l" }, {
    value_type: "list",
    item_type: "enum",
    values: ["a", "b"],
  })));
  assert(
    !contractTypeSchema.safeParse({
      ...experiment,
      fields: [experiment.fields[0], experiment.fields[0]],
    }).success,
    "duplicate field names",
  );
});

Deno.test("documents/contexts#R14 [ctx-S10]: types, fields and relations are private unless marked public", () => {
  const { visibility: _, ...noVisibility } = experiment;
  const parsed = contractTypeSchema.parse(noVisibility);
  assertEquals(parsed.visibility, "private");
  assertEquals(parsed.relations[0].visibility, "private");
  assert(
    contractTypeSchema.safeParse({
      ...experiment,
      relations: [{ ...experiment.relations[0], to: "eval/Scenario" }],
    }).success,
    "external public reference has the context/Type shape",
  );
  assert(
    !contractTypeSchema.safeParse({
      ...experiment,
      relations: [{ ...experiment.relations[0], to: "eval.scenario" }],
    }).success,
  );
});

const findingsSearch = {
  name: "findings_for_experiment",
  title: "Findings for an experiment",
  inputs: [{
    name: "experiment",
    label: "Experiment",
    type: "entity",
    of: "Experiment",
  }],
  query: {
    from: "Finding",
    where: { path: "experiment", op: "eq", value: { input: "experiment" } },
    follow: [{
      relation: "about",
      as: "exp",
      direction: "forward",
    }],
    sort: [{ path: "key", dir: "desc" }],
  },
  result: {
    kind: "table",
    columns: [{ label: "Finding", path: "key" }, {
      label: "Status",
      path: "exp.status",
    }],
  },
};

Deno.test("documents/contexts#R15 [ctx-S10]: a declared search has typed inputs, a declarative query and a result view", () => {
  const parsed = declaredSearchSchema.parse(findingsSearch);
  assertEquals(parsed.result.page_size, 30);
  assertEquals(parsed.query.group, null);
  assertEquals(parsed.inputs[0].many, false);
  const bad = (patch: Record<string, unknown>) =>
    !declaredSearchSchema.safeParse({ ...findingsSearch, ...patch }).success;
  assert(bad({ name: "Findings" }));
  assert(bad({
    inputs: [{ name: "q", label: "Text", type: "text", of: "Finding" }],
  }));
  assert(bad({ inputs: [{ name: "e", label: "E", type: "entity" }] }));
  assert(bad({
    inputs: [findingsSearch.inputs[0], findingsSearch.inputs[0]],
  }));
  assert(bad({
    query: {
      ...findingsSearch.query,
      where: { path: "status", op: "exists", value: "x" },
    },
  }));
  assert(bad({
    query: { ...findingsSearch.query, where: { path: "status", op: "eq" } },
  }));
  assert(bad({
    query: { ...findingsSearch.query, where: { path: "a.b.c", op: "exists" } },
  }));
  assert(bad({ query: { ...findingsSearch.query, where: { all: [] } } }));
  assert(
    !declaredSearchSchema.safeParse({
      ...findingsSearch,
      query: {
        ...findingsSearch.query,
        follow: [
          findingsSearch.query.follow[0],
          findingsSearch.query.follow[0],
        ],
      },
    }).success,
    "follow aliases are unique",
  );
  assert(
    declaredSearchSchema.safeParse({
      ...findingsSearch,
      query: {
        ...findingsSearch.query,
        where: {
          all: [
            { path: "status", op: "in", value: ["open", "closed"] },
            { not: { path: "exp.status", op: "exists" } },
          ],
        },
      },
    }).success,
  );
});

Deno.test("documents/contexts#R15 [ctx-S10]: result views are a table with columns or a board split by a value", () => {
  assert(
    resultViewSchema.safeParse({ kind: "table", columns: [] }).success ===
      false,
  );
  assert(resultViewSchema.safeParse({ kind: "board" }).success === false);
  assert(
    resultViewSchema.safeParse({ kind: "board", board_by: "status" }).success,
  );
  assert(
    !resultViewSchema.safeParse({
      kind: "table",
      columns: [{ label: "Key", path: "key" }],
      board_by: "status",
    }).success,
  );
  assert(
    !resultViewSchema.safeParse({
      kind: "table",
      columns: [{ label: "Key", path: "key" }],
      page_size: 101,
    }).success,
  );
});

Deno.test("documents/contexts#R18 #R19 [ctx-S10]: a bundle holds the contract, searches, saved views and examples with unique names", () => {
  const scenario = {
    name: "Scenario",
    summary: "A task the agent is graded on",
    visibility: "public",
    source: { kind: "docs", paths: ["eval/scenarios/*.md"] },
    key: "id",
    fields: [field("id", { kind: "path", capture: "file" })],
  };
  const bundle = {
    schema: 1,
    contract: { types: [experiment, scenario] },
    searches: [findingsSearch],
    saved_views: [{
      name: "Open findings of exp-008",
      search: "findings_for_experiment",
      inputs: { experiment: "exp-008" },
    }],
    examples: [
      {
        kind: "search",
        search: "findings_for_experiment",
        inputs: { experiment: "exp-008" },
        expect_keys: ["F-009"],
      },
      {
        kind: "entity",
        path: "eval/experiments/exp-008-sight.md",
        expect: { type: "Experiment", key: "008", fields: { status: "done" } },
      },
    ],
  };
  const parsed = bundleContentSchema.parse(bundle);
  assertEquals(
    parsed.examples[1].kind === "entity" && parsed.examples[1].section,
    null,
  );
  assert(!bundleContentSchema.safeParse({ ...bundle, schema: 2 }).success);
  assert(
    !bundleContentSchema.safeParse({
      ...bundle,
      contract: { types: [experiment, experiment] },
    }).success,
    "type names are unique",
  );
  assert(
    !bundleContentSchema.safeParse({
      ...bundle,
      searches: [findingsSearch, findingsSearch],
    }).success,
    "search names are unique",
  );
  assert(
    !bundleContentSchema.safeParse({
      ...bundle,
      saved_views: [bundle.saved_views[0], {
        ...bundle.saved_views[0],
        name: " Open findings of exp-008 ",
      }],
    }).success,
    "saved view names are unique after trimming",
  );
  assert(
    !bundleContentSchema.safeParse({ ...bundle, contract: { types: [] } })
      .success,
  );
  assert(!bundleContentSchema.safeParse({ ...bundle, extra: true }).success);
});

Deno.test("documents/contexts#R14 [ctx-I36]: a reference to another context is `<title>/<Type>` split at the last slash, and a bare Type name is not one", () => {
  assertEquals(splitExternalRef("rubrics/Rubric"), {
    context: "rubrics",
    type: "Rubric",
  });
  // the title is compared as written: spaces, capitals and slashes belong to it
  assertEquals(splitExternalRef("Eval notes/Finding"), {
    context: "Eval notes",
    type: "Finding",
  });
  assertEquals(splitExternalRef("a/b/Finding"), {
    context: "a/b",
    type: "Finding",
  });
  for (
    const not of [
      "Rubric",
      "rubrics/rubric",
      "rubrics/",
      "/Rubric",
      "  /Rubric",
      "rubrics/Rubric/",
      "eval.scenario",
    ]
  ) {
    assertEquals(splitExternalRef(not), undefined, not);
  }
});
