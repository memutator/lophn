// 시험과 화면 시안이 쓰는 ContextsSource. tools/wireframes의 phroner 예시(eval·harness context,
// Experiment·Scenario·Rubric·Finding)와 같은 값을 계약 모양으로 담는다. 명령은 메모리의 값을
// 바꾸고 calls에 남긴다. 값이 계약에 맞는지는 fake-source_test.ts가 계약 schema로 검사한다.
import type {
  BaseRevision,
  BundleContent,
  BundleEntry,
  CommandResult,
  ContainingContext,
  ContextContract,
  ContextDetail,
  ContextDraft,
  ContextListItem,
  ContextOverview,
  ContextsSource,
  DraftProgress,
  GlossaryEntry,
  GlossaryRemoveRequest,
  GlossarySetRequest,
  HandOffRequest,
  HandOffResult,
  InputOptions,
  InputOptionsRequest,
  PickOption,
  ReadResult,
  RollbackRequest,
  RollbackResult,
  SavedViewListItem,
  SavedViewValue,
  SaveViewRequest,
  SearchPage,
  SearchRequest,
  SearchRow,
  StoredViolation,
  ViolationItem,
  ViolationKey,
  ViolationsPage,
} from "./source.ts";

export function fakeId(prefix: string, seed: string): string {
  return `${prefix}_${seed.padStart(26, "0")}`;
}

export const PROJECT = fakeId("prj", "ph1");
export const EVAL = fakeId("ctx", "ev4");
export const HARNESS = fakeId("ctx", "hns");
export const RELEASE_NOTES = fakeId("ctx", "rn1");

const SHA = (digit: string) => digit.repeat(64);
const ok = <T>(value: T): ReadResult<T> => ({ ok: true, value });

// ---------- context ----------

function listItem(
  fields: {
    id: string;
    title: string;
    purpose: string;
    status: "drafting" | "active";
    applied: { number: number; bundle: string } | null;
    violations: number;
    revision: string;
    draft?: string;
  },
): ContextListItem {
  return {
    id: fields.id,
    project: PROJECT,
    title: fields.title,
    purpose: fields.purpose,
    status: fields.status,
    applied_bundle: fields.applied?.bundle ?? null,
    violation_mark: fields.violations,
    revision: fields.revision,
    applied_number: fields.applied?.number ?? null,
    draft_bundle: fields.draft ?? null,
    checking_bundle: null,
  };
}

export const EVAL_ITEM = listItem({
  id: EVAL,
  title: "eval",
  purpose:
    "Keep experiments, scenarios, rubrics and findings of the eval loop findable.",
  status: "active",
  applied: { number: 3, bundle: fakeId("cbn", "ev3") },
  violations: 2,
  revision: "21",
});
export const HARNESS_ITEM = listItem({
  id: HARNESS,
  title: "harness",
  purpose: "Keep harness changes and components findable.",
  status: "active",
  applied: { number: 5, bundle: fakeId("cbn", "hn5") },
  violations: 0,
  revision: "34",
});
export const RELEASE_NOTES_ITEM = listItem({
  id: RELEASE_NOTES,
  title: "release-notes",
  purpose:
    "Keep release notes, changelogs and the issues they close findable, so an Operator can draft the next release note.",
  status: "drafting",
  applied: null,
  violations: 0,
  revision: "40",
  draft: fakeId("cbn", "rn0"),
});

// ---------- 판과 검사 ----------

function appliedEntry(
  context: string,
  number: number,
  status: "applied" | "superseded",
  finishedAt: string,
  digit: string,
): BundleEntry {
  const bundle = fakeId("cbn", `${context.slice(-3)}${number}`);
  const check = fakeId("chk", `${context.slice(-3)}${number}`);
  return {
    bundle: {
      id: bundle,
      context,
      number,
      parent: number > 1
        ? fakeId("cbn", `${context.slice(-3)}${number - 1}`)
        : null,
      bundle_hash: SHA(digit),
      status,
      check,
      created_by: `agent:${fakeId("asg", "ce1")}`,
      revision: String(number),
    },
    check: {
      id: check,
      context,
      bundle,
      status: "passed",
      snapshot_hash: SHA(digit),
      findings: [],
      violation_count: 2,
      started_at: finishedAt,
      finished_at: finishedAt,
    },
  };
}

const BUNDLES: Readonly<Record<string, readonly BundleEntry[]>> = {
  [EVAL]: [
    appliedEntry(EVAL, 3, "applied", "2026-10-12T07:00:00.000Z", "a"),
    appliedEntry(EVAL, 2, "superseded", "2026-10-05T07:00:00.000Z", "b"),
  ],
  [HARNESS]: [
    appliedEntry(HARNESS, 5, "applied", "2026-10-11T09:00:00.000Z", "c"),
  ],
  [RELEASE_NOTES]: [],
};

// ---------- 계약 ----------

type Contract = BundleContent["contract"];
type Type = Contract["types"][number];
type Field = Type["fields"][number];
type Relation = Type["relations"][number];

const field = (
  name: string,
  from: Field["from"],
  extra: Partial<Field> = {},
): Field => ({
  name,
  from,
  value_type: "string",
  required: false,
  visibility: "private",
  ...extra,
});
const section = (heading: string): Field["from"] => ({
  kind: "section",
  heading,
  include_children: false,
});
const frontmatter = (key: string): Field["from"] => ({
  kind: "frontmatter",
  key,
});
const links = (to_type?: string): Field["from"] => ({
  kind: "links",
  ...(to_type === undefined ? {} : { to_type }),
});
const relation = (
  name: string,
  label: string,
  to: string,
  via: string,
  cardinality: Relation["cardinality"],
  visibility: Relation["visibility"] = "private",
): Relation => ({ name, label, to, via, cardinality, visibility });

const EVAL_TYPES: readonly Type[] = [
  {
    name: "Experiment",
    summary: "Tests whether one change helps, on a set of scenarios.",
    visibility: "public",
    source: {
      kind: "series",
      pattern: "eval/experiments/exp-{n}-*.md",
      order: "natural",
    },
    key: "id",
    fields: [
      field("id", { kind: "path", capture: "n" }, { required: true }),
      field("status", frontmatter("status"), {
        value_type: "enum",
        values: ["draft", "running", "reported"],
        required: true,
        visibility: "public",
      }),
      field("question", section("질문")),
      field("baseline", section("기준선")),
      field("about", links("Change")),
      field("scenarios", links("Scenario"), {
        value_type: "list",
        item_type: "string",
      }),
      field("findings", links("Finding"), {
        value_type: "list",
        item_type: "string",
      }),
    ],
    relations: [
      relation("about", "checks", "harness/Change", "about", "one", "public"),
      relation("scenarios", "runs on", "Scenario", "scenarios", "many"),
      relation("findings", "produces", "Finding", "findings", "many"),
    ],
    rules: [{
      id: "about-required",
      message: "about is required",
      kind: "required_field",
      params: { field: "about" },
    }],
  },
  {
    name: "Scenario",
    summary: "One task the agent is asked to do, with stages that score it.",
    visibility: "private",
    source: {
      kind: "folder",
      root: "eval/scenarios",
      child_pattern: "*",
      depth: 1,
    },
    key: "id",
    fields: [
      field("id", { kind: "path", capture: "folder" }, { required: true }),
      field("tags", { kind: "yaml", key_path: ["tags"] }, {
        value_type: "list",
        item_type: "string",
      }),
      field("stages", { kind: "yaml", key_path: ["stages"] }, {
        value_type: "list",
        item_type: "string",
      }),
      field("rubric", links("Rubric")),
    ],
    relations: [relation("rubric", "graded by", "Rubric", "rubric", "one")],
    rules: [],
  },
  {
    name: "Rubric",
    summary: "How a judge scores the work.",
    visibility: "private",
    source: {
      kind: "folder",
      root: "eval/rubrics",
      child_pattern: "*",
      depth: 1,
    },
    key: "id",
    fields: [
      field("id", { kind: "path", capture: "folder" }, { required: true }),
      field("criteria", { kind: "yaml", key_path: ["criteria"] }, {
        value_type: "list",
        item_type: "string",
      }),
    ],
    relations: [],
    rules: [],
  },
  {
    name: "Finding",
    summary: "What an experiment showed about a change.",
    visibility: "public",
    source: {
      kind: "series",
      pattern: "loop/findings/F-{n}.md",
      order: "natural",
    },
    key: "id",
    fields: [
      field("id", { kind: "path", capture: "n" }, { required: true }),
      field("kind", frontmatter("kind"), {
        value_type: "enum",
        values: ["improvement", "regression", "neutral"],
        required: true,
      }),
      field("effects", frontmatter("effects"), {
        value_type: "list",
        item_type: "enum",
        values: ["world_actions", "tool_calls", "answer_match"],
      }),
      field("change", frontmatter("change")),
      field("scenarios", links("Scenario"), {
        value_type: "list",
        item_type: "string",
      }),
    ],
    relations: [
      relation("about", "about", "harness/Change", "change", "one", "public"),
      relation("from", "from", "Scenario", "scenarios", "many"),
    ],
    rules: [],
  },
];

const HARNESS_TYPES: readonly Type[] = [
  {
    name: "Change",
    summary: "A change to the harness being evaluated.",
    visibility: "public",
    source: {
      kind: "series",
      pattern: "harness/changes/C-{n}.md",
      order: "natural",
    },
    key: "id",
    fields: [
      field("id", { kind: "path", capture: "n" }, { required: true }),
      field("title", { kind: "title" }),
    ],
    relations: [],
    rules: [],
  },
  {
    name: "Component",
    summary: "A part of the harness a change touches.",
    visibility: "private",
    source: {
      kind: "folder",
      root: "harness/components",
      child_pattern: "*",
      depth: 1,
    },
    key: "id",
    fields: [field("id", { kind: "path", capture: "folder" }, {
      required: true,
    })],
    relations: [],
    rules: [],
  },
];

const input = (
  name: string,
  label: string,
  type: "entity" | "value" | "range" | "text",
  of: string | undefined,
  extra: { many?: boolean; required?: boolean } = {},
) => ({
  name,
  label,
  type,
  ...(of === undefined ? {} : { of }),
  many: extra.many ?? false,
  required: extra.required ?? false,
});

const EVAL_SEARCHES: BundleContent["searches"] = [
  {
    name: "findings_about_change",
    title: "Findings about a change",
    inputs: [
      input("change", "Change", "value", "Finding.change"),
      input("kind", "Kind", "value", "Finding.kind", { many: true }),
      input("metric", "Metric", "value", "Finding.effects"),
    ],
    query: {
      from: "Finding",
      where: {
        all: [
          { path: "change", op: "eq", value: { input: "change" } },
          { path: "kind", op: "in", value: { input: "kind" } },
          { path: "effects", op: "contains", value: { input: "metric" } },
        ],
      },
      follow: [
        {
          relation: "from",
          as: "scenario",
          direction: "forward",
        },
        {
          relation: "findings",
          as: "experiment",
          direction: "reverse",
        },
      ],
      sort: [],
      group: null,
    },
    result: {
      kind: "table",
      columns: [
        { label: "Finding", path: "key" },
        { label: "Kind", path: "kind" },
        { label: "Scenario", path: "scenario.key" },
        { label: "Effect", path: "effect" },
        { label: "Experiment", path: "experiment.key" },
      ],
      page_size: 5,
    },
  },
  {
    name: "experiments_by_status",
    title: "Experiments by status",
    inputs: [
      input("scenario", "Scenario", "entity", "Scenario"),
      input("status", "Status", "value", "Experiment.status", { many: true }),
    ],
    query: {
      from: "Experiment",
      where: { path: "status", op: "in", value: { input: "status" } },
      follow: [],
      sort: [],
      group: null,
    },
    result: {
      kind: "board",
      columns: [
        { label: "Title", path: "title" },
        { label: "Scenarios", path: "scenario_count" },
        { label: "Findings", path: "finding_count" },
      ],
      board_by: "status",
      page_size: 30,
    },
  },
  {
    name: "scenarios_by_rubric",
    title: "Scenarios using a rubric",
    inputs: [input("rubric", "Rubric", "entity", "Rubric", { required: true })],
    query: {
      from: "Scenario",
      where: { path: "rubric", op: "eq", value: { input: "rubric" } },
      follow: [],
      sort: [],
      group: null,
    },
    result: {
      kind: "table",
      columns: [
        { label: "Scenario", path: "key" },
        { label: "Tags", path: "tags" },
      ],
      page_size: 30,
    },
  },
];

function searchExamples(): BundleContent["examples"] {
  return EVAL_SEARCHES.flatMap((search) =>
    Array.from({ length: 6 }, (_, index) => ({
      kind: "search" as const,
      search: search.name,
      inputs: {},
      expect_keys: [`example-${index + 1}`],
    }))
  );
}

const EVAL_ENTITY_EXAMPLES: BundleContent["examples"] = [
  ["Experiment", "exp-008", "eval/experiments/exp-008-query-tools.md"],
  ["Scenario", "query-leave-still", "eval/scenarios/query-leave-still/r1.yaml"],
  ["Rubric", "schedule-quality", "eval/rubrics/schedule-quality/r1.yaml"],
  ["Finding", "F-009", "loop/findings/F-009.md"],
].map(([type, key, path]) => ({
  kind: "entity" as const,
  path: path!,
  section: null,
  expect: { type: type!, key: key! },
}));

const EVAL_CONTENT: BundleContent = {
  schema: 1,
  contract: { types: [...EVAL_TYPES] },
  searches: [...EVAL_SEARCHES],
  saved_views: [],
  examples: [...EVAL_ENTITY_EXAMPLES, ...searchExamples()],
};

const HARNESS_CONTENT: BundleContent = {
  schema: 1,
  contract: { types: [...HARNESS_TYPES] },
  searches: [],
  saved_views: [],
  examples: [],
};

const CONTENT: Readonly<Record<string, BundleContent>> = {
  [EVAL]: EVAL_CONTENT,
  [HARNESS]: HARNESS_CONTENT,
};

const OVERVIEW: Readonly<Record<string, ContextOverview["types"]>> = {
  [EVAL]: [
    { type: "Experiment", count: 13 },
    { type: "Scenario", count: 34 },
    { type: "Rubric", count: 2 },
    { type: "Finding", count: 14 },
  ],
  [HARNESS]: [
    { type: "Change", count: 52 },
    { type: "Component", count: 18 },
  ],
  [RELEASE_NOTES]: [],
};

// ---------- 위반 ----------

const VIOLATIONS: Readonly<Record<string, readonly StoredViolation[]>> = {
  [EVAL]: [
    {
      context: EVAL,
      bundle_hash: SHA("a"),
      kind: "rule",
      rule: "Experiment.about-required",
      path: "eval/experiments/exp-012-ftb-quests-021-q8.md",
      section: null,
      type: "Experiment",
      target: "about",
      message: "about is missing",
    },
    {
      context: EVAL,
      bundle_hash: SHA("a"),
      kind: "broken_link",
      rule: null,
      path: "loop/findings/F-014.md",
      section: null,
      type: "Finding",
      target: "sched-x",
      message: "scenario sched-x doesn't exist",
    },
  ],
  [HARNESS]: [],
  [RELEASE_NOTES]: [],
};

const HANDED_OFF: Readonly<Record<string, readonly ViolationKey[]>> = {
  [EVAL]: [{
    kind: "broken_link",
    rule: null,
    path: "loop/findings/F-014.md",
    section: null,
  }],
};

const keyOf = (key: ViolationKey) =>
  JSON.stringify([key.kind, key.rule, key.path, key.section]);

// ---------- 용어집 ----------

function entry(
  id: string,
  context: string,
  term: string,
  meaning: string,
  set_by: "user" | "agent",
  updated_at: string,
  revision: string,
): GlossaryEntry {
  return {
    id: fakeId("trm", id),
    context,
    term,
    meaning,
    set_by,
    updated_at,
    revision,
  };
}

const GLOSSARY: Readonly<Record<string, readonly GlossaryEntry[]>> = {
  [EVAL]: [
    entry(
      "g1",
      EVAL,
      "rubric",
      "How a judge scores the work of a scenario.",
      "agent",
      "2026-10-09T09:00:00.000Z",
      "50",
    ),
    entry(
      "g2",
      EVAL,
      "scenario",
      "One task the agent is asked to do.",
      "user",
      "2026-10-10T09:00:00.000Z",
      "51",
    ),
    entry(
      "g3",
      EVAL,
      "world action",
      "An action that changes the game world, such as breaking a block.",
      "agent",
      "2026-10-12T08:00:00.000Z",
      "52",
    ),
  ],
  [HARNESS]: [],
  [RELEASE_NOTES]: [],
};

// ---------- 저장한 보기 ----------

const VIEWS: Readonly<Record<string, readonly SavedViewListItem[]>> = {
  [EVAL]: [
    {
      id: fakeId("viw", "v1"),
      context: EVAL,
      name: "Findings for C-049",
      search: "findings_about_change",
      inputs: { change: "c-049" },
      origin: "user",
      revision: "60",
      broken: false,
    },
    {
      id: fakeId("viw", "v2"),
      context: EVAL,
      name: "Running experiments",
      search: "experiments_by_status",
      inputs: { status: ["running"] },
      origin: "engineer",
      revision: "61",
      broken: false,
    },
  ],
  [HARNESS]: [],
  [RELEASE_NOTES]: [],
};

// ---------- 검색 결과 ----------

interface FindingData {
  id: string;
  kind: "improvement" | "regression";
  scenario: string;
  effect: string;
  experiment: string;
}

const f = (
  id: string,
  kind: FindingData["kind"],
  scenario: string,
  effect: string,
  experiment: string,
): FindingData => ({ id, kind, scenario, effect, experiment });

// 먼저 만진 순서. 첫 page에 F-009가 보인다.
const FINDINGS: readonly FindingData[] = [
  f(
    "F-009",
    "improvement",
    "query-leave-still",
    "world_actions 3 → 0",
    "exp-008",
  ),
  f("F-010", "improvement", "query-chest-name", "tool_calls 5 → 2", "exp-008"),
  f(
    "F-011",
    "regression",
    "query-recipe-gap",
    "answer_match 0.8 → 0.6",
    "exp-008",
  ),
  f("F-013", "improvement", "query-route-plan", "steps 12 → 7", "exp-011"),
  f("F-014", "improvement", "query-chest-name", "tool_calls 4 → 3", "exp-011"),
  f("F-001", "improvement", "sched-basic", "retries 4 → 1", "exp-005"),
  f(
    "F-002",
    "improvement",
    "sched-overlap",
    "answer_match 0.6 → 0.9",
    "exp-005",
  ),
  f("F-003", "regression", "sched-long-list", "latency_s 3 → 6", "exp-005"),
  f("F-004", "improvement", "inv-read", "world_actions 2 → 0", "exp-006"),
  f("F-005", "improvement", "inv-total", "answer_match 0.7 → 1.0", "exp-006"),
  f("F-006", "improvement", "recipe-lookup", "tool_calls 6 → 3", "exp-007"),
  f("F-007", "regression", "recipe-dup", "answer_match 0.9 → 0.7", "exp-007"),
  f("F-008", "improvement", "recipe-swap", "tokens 900 → 600", "exp-007"),
  f("F-012", "improvement", "query-chest-name", "latency_s 5 → 3", "exp-011"),
];

const CHANGE_OF: Readonly<Record<string, string>> = {
  "exp-008": "c-049",
  "exp-011": "c-041",
  "exp-005": "c-038",
  "exp-006": "c-050",
  "exp-007": "c-040",
};

export const EXPERIMENT_NAMES: Readonly<Record<string, string>> = {
  "exp-005": "schedule tools",
  "exp-006": "inventory read",
  "exp-007": "recipe lookup",
  "exp-008": "query tools",
  "exp-011": "chest names",
  "exp-012": "ftb quests 021 q8",
  "exp-013": "ftb quests 2",
  "exp-014": "route planner",
};

export const experimentPath = (id: string) =>
  `eval/experiments/${id}-${EXPERIMENT_NAMES[id]!.replaceAll(" ", "-")}.md`;

const EXPERIMENTS: readonly {
  id: string;
  status: "draft" | "running" | "reported";
  scenarios: number;
  findings: number;
}[] = [
  { id: "exp-013", status: "draft", scenarios: 4, findings: 0 },
  { id: "exp-014", status: "draft", scenarios: 2, findings: 0 },
  { id: "exp-008", status: "running", scenarios: 6, findings: 3 },
  { id: "exp-011", status: "running", scenarios: 3, findings: 0 },
  { id: "exp-012", status: "running", scenarios: 5, findings: 0 },
  { id: "exp-007", status: "reported", scenarios: 5, findings: 4 },
  { id: "exp-006", status: "reported", scenarios: 6, findings: 2 },
  { id: "exp-005", status: "reported", scenarios: 4, findings: 1 },
];

const asList = (value: unknown): readonly string[] =>
  value === undefined || value === null || value === ""
    ? []
    : Array.isArray(value)
    ? value.map(String)
    : [String(value)];

const findingRef = (id: string): SearchRow["ref"] => ({
  type: "Finding",
  key: id,
  path: `loop/findings/${id}.md`,
  section: null,
});
const experimentRef = (id: string): SearchRow["ref"] => ({
  type: "Experiment",
  key: id,
  path: experimentPath(id),
  section: null,
});

function findingRows(inputs: Readonly<Record<string, unknown>>): SearchRow[] {
  const change = asList(inputs.change)[0];
  const kinds = asList(inputs.kind);
  const metric = asList(inputs.metric)[0];
  return FINDINGS
    .filter((item) =>
      (change === undefined || CHANGE_OF[item.experiment] === change) &&
      (kinds.length === 0 || kinds.includes(item.kind)) &&
      (metric === undefined || item.effect.startsWith(`${metric} `))
    )
    .map((item): SearchRow => ({
      ref: findingRef(item.id),
      cells: [
        { path: "key", value: item.id, ref: findingRef(item.id) },
        { path: "kind", value: item.kind, ref: null },
        {
          path: "scenario.key",
          value: item.scenario,
          ref: {
            type: "Scenario",
            key: item.scenario,
            path: `eval/scenarios/${item.scenario}/r1.yaml`,
            section: null,
          },
        },
        { path: "effect", value: item.effect, ref: null },
        {
          path: "experiment.key",
          value: item.experiment,
          ref: experimentRef(item.experiment),
        },
      ],
    }));
}

function experimentRows(
  inputs: Readonly<Record<string, unknown>>,
): SearchRow[] {
  const statuses = asList(inputs.status);
  return EXPERIMENTS
    .filter((item) => statuses.length === 0 || statuses.includes(item.status))
    .map((item): SearchRow => ({
      ref: experimentRef(item.id),
      // 열 순서의 cell 뒤에 board_by(status)의 cell이 따른다.
      cells: [
        { path: "title", value: EXPERIMENT_NAMES[item.id]!, ref: null },
        { path: "scenario_count", value: item.scenarios, ref: null },
        { path: "finding_count", value: item.findings, ref: null },
        { path: "status", value: item.status, ref: null },
      ],
    }));
}

const OPTIONS: Readonly<Record<string, readonly PickOption[]>> = {
  "findings_about_change/change": [
    {
      value: "c-049",
      label: "C-049 · 행동 전에 로드된 월드와 등록 정보를 조회한다",
    },
    { value: "c-041", label: "C-041 · 상자 이름 조회를 한 번에 묶는다" },
    { value: "c-040", label: "C-040 · 레시피 조회 결과를 캐시한다" },
    { value: "c-050", label: "C-050 · 읽기 전용 과제에서 월드 행동을 막는다" },
    { value: "c-038", label: "C-038 · 일정 도구의 재시도를 줄인다" },
  ],
  "findings_about_change/kind": [
    { value: "improvement", label: "improvement" },
    { value: "regression", label: "regression" },
    { value: "neutral", label: "neutral" },
  ],
  "findings_about_change/metric": [
    { value: "world_actions", label: "world_actions" },
    { value: "tool_calls", label: "tool_calls" },
    { value: "answer_match", label: "answer_match" },
  ],
  "experiments_by_status/scenario": [
    { value: "query-leave-still", label: "query-leave-still" },
    { value: "query-chest-name", label: "query-chest-name" },
    { value: "query-recipe-gap", label: "query-recipe-gap" },
  ],
  "experiments_by_status/status": [
    { value: "draft", label: "draft" },
    { value: "running", label: "running" },
    { value: "reported", label: "reported" },
  ],
  "scenarios_by_rubric/rubric": [
    { value: "schedule-quality", label: "schedule-quality" },
    { value: "answer-match", label: "answer-match" },
  ],
};

// ---------- 문서가 든 context ----------

const CONTAINING: Readonly<Record<string, readonly ContainingContext[]>> = {
  "eval/experiments/exp-008-query-tools.md": [
    { context: EVAL, title: "eval", types: ["Experiment"] },
  ],
  "loop/findings/F-009.md": [
    { context: EVAL, title: "eval", types: ["Finding"] },
  ],
  "harness/changes/C-049.md": [
    { context: HARNESS, title: "harness", types: ["Change"] },
  ],
  "docs/shared-overview.md": [
    { context: EVAL, title: "eval", types: ["Finding"] },
    { context: HARNESS, title: "harness", types: ["Change"] },
  ],
};

// ---------- 만드는 중 ----------

// 초안 content는 submit 전이라 검사되지 않은 JSON 객체다: 개체 이름과 관계만 적었다.
const DRAFT: DraftProgress = {
  step: 2,
  bundle: {
    id: fakeId("cbn", "rn0"),
    context: RELEASE_NOTES,
    number: null,
    parent: null,
    bundle_hash: null,
    status: "draft",
    check: null,
    created_by: `agent:${fakeId("asg", "ce1")}`,
    revision: "1",
  },
  content: {
    schema: 1,
    contract: {
      types: [
        {
          name: "Changelog entry",
          relations: [{ name: "release", label: "mentions", to: "Release" }],
        },
        {
          name: "Release",
          relations: [{ name: "issues", label: "closes", to: "Issue" }],
        },
        { name: "Issue", relations: [] },
      ],
    },
  },
  check: null,
};

// ---------- fake source ----------

export type FakeCall =
  | { command: "saveView"; request: SaveViewRequest }
  | {
    command: "glossarySet";
    request: GlossarySetRequest;
    compare?: BaseRevision;
  }
  | {
    command: "glossaryRemove";
    request: GlossaryRemoveRequest;
    compare: BaseRevision;
  }
  | { command: "handOffViolations"; request: HandOffRequest }
  | { command: "rollback"; request: RollbackRequest };

export interface FakeContextsSource extends ContextsSource {
  /** 보낸 명령을 순서대로. */
  readonly calls: readonly FakeCall[];
}

export interface FakeOptions {
  /** true면 context가 하나도 없다. */
  empty?: boolean;
  /** true면 만드는 중인 release-notes도 목록에 있다. */
  drafting?: boolean;
  /** 문서 경로 → 그 문서가 든 context. 주면 기본 표를 대신한다. */
  containing?: Readonly<Record<string, readonly ContainingContext[]>>;
}

export function createFakeContextsSource(
  options: FakeOptions = {},
): FakeContextsSource {
  const calls: FakeCall[] = [];
  const items = options.empty ? [] : [
    EVAL_ITEM,
    HARNESS_ITEM,
    ...(options.drafting ? [RELEASE_NOTES_ITEM] : []),
  ];
  const itemOf = (id: string) => items.find((item) => item.id === id);
  const missing = <T>(): ReadResult<T> => ({
    ok: false,
    message: "not_found",
  });

  const glossary = new Map(
    Object.entries(GLOSSARY).map(([key, list]) => [key, [...list]]),
  );
  const views = new Map(
    Object.entries(VIEWS).map(([key, list]) => [key, [...list]]),
  );
  const handedOff = new Map(
    Object.entries(HANDED_OFF).map(([key, list]) => [key, [...list]]),
  );
  let revision = 100;
  const nextRevision = () => String(++revision);

  return {
    calls,
    list: () => Promise.resolve(ok(items)),
    get(context): Promise<ReadResult<ContextDetail>> {
      const item = itemOf(context);
      if (item === undefined) return Promise.resolve(missing());
      const applied = BUNDLES[context]?.[0]?.bundle;
      return Promise.resolve(ok({
        context: {
          id: item.id,
          project: item.project,
          title: item.title,
          purpose: item.purpose,
          status: item.status,
          applied_bundle: item.applied_bundle,
          violation_mark: item.violation_mark,
          revision: item.revision,
        },
        applied: applied?.status === "applied" ? applied : null,
      }));
    },
    overview(context): Promise<ReadResult<ContextOverview>> {
      const item = itemOf(context);
      if (item === undefined) return Promise.resolve(missing());
      return Promise.resolve(ok({
        context: {
          id: item.id,
          project: item.project,
          title: item.title,
          purpose: item.purpose,
          status: item.status,
          applied_bundle: item.applied_bundle,
          violation_mark: item.violation_mark,
          revision: item.revision,
        },
        bundle_hash: BUNDLES[context]?.[0]?.bundle.bundle_hash ?? null,
        types: OVERVIEW[context] ?? [],
        violation_count: item.violation_mark,
      }));
    },
    contract(context): Promise<ReadResult<ContextContract>> {
      const applied = BUNDLES[context]?.[0]?.bundle;
      const live = applied?.status === "applied" ? applied : undefined;
      return Promise.resolve(ok({
        context,
        bundle: live?.id ?? null,
        bundle_hash: live?.bundle_hash ?? null,
        content: live === undefined ? null : CONTENT[context] ?? null,
      }));
    },
    draft(context): Promise<ReadResult<ContextDraft>> {
      return Promise.resolve(ok({
        context,
        draft: context === RELEASE_NOTES ? DRAFT : null,
      }));
    },
    bundles: (context) => Promise.resolve(ok(BUNDLES[context] ?? [])),
    search(request: SearchRequest): Promise<ReadResult<SearchPage>> {
      const declared = CONTENT[request.context]?.searches.find((search) =>
        search.name === request.search
      );
      if (declared === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      const rows = request.search === "findings_about_change"
        ? findingRows(request.inputs)
        : request.search === "experiments_by_status"
        ? experimentRows(request.inputs)
        : [];
      const size = request.page_size ?? declared.result.page_size;
      const offset = request.cursor === undefined ? 0 : Number(request.cursor);
      const end = offset + size;
      return Promise.resolve(ok({
        rows: rows.slice(offset, end),
        complete: end >= rows.length,
        next_cursor: end >= rows.length ? null : String(end),
        total: rows.length,
      }));
    },
    inputOptions(
      request: InputOptionsRequest,
    ): Promise<ReadResult<InputOptions>> {
      return Promise.resolve(ok({
        search: request.search,
        input: request.input,
        options: [...(OPTIONS[`${request.search}/${request.input}`] ?? [])],
        complete: true,
      }));
    },
    violations(context): Promise<ReadResult<ViolationsPage>> {
      const known = new Set((handedOff.get(context) ?? []).map(keyOf));
      return Promise.resolve(ok({
        violations: (VIOLATIONS[context] ?? []).map((
          violation,
        ): ViolationItem => ({
          ...violation,
          handed_off: known.has(keyOf(violation)),
        })),
        complete: true,
        next_cursor: null,
      }));
    },
    glossary: (context) =>
      Promise.resolve(ok(
        [...(glossary.get(context) ?? [])].sort((a, b) =>
          a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1
        ),
      )),
    savedViews: (context) => Promise.resolve(ok(views.get(context) ?? [])),
    containing(_project, path) {
      return Promise.resolve(
        ok((options.containing ?? CONTAINING)[path] ?? []),
      );
    },
    operatorCounts: () =>
      Promise.resolve(ok(new Map([[EVAL, 1], [HARNESS, 2]]))),

    saveView(request): Promise<CommandResult<SavedViewValue>> {
      calls.push({ command: "saveView", request });
      const value: SavedViewValue = {
        id: fakeId("viw", `n${calls.length}`),
        context: request.context,
        name: request.name,
        search: request.search,
        inputs: request.inputs,
        origin: "user",
        revision: nextRevision(),
      };
      views.set(request.context, [
        ...(views.get(request.context) ?? []),
        { ...value, broken: false },
      ]);
      return Promise.resolve(ok(value));
    },
    glossarySet(request, compare): Promise<CommandResult<GlossaryEntry>> {
      calls.push({
        command: "glossarySet",
        request,
        ...(compare === undefined ? {} : { compare }),
      });
      const now = "2026-10-12T09:00:00.000Z";
      if ("entry" in request) {
        for (const [context, list] of glossary) {
          const at = list.findIndex((item) => item.id === request.entry);
          if (at === -1) continue;
          const next: GlossaryEntry = {
            ...list[at]!,
            ...(request.term === undefined ? {} : { term: request.term }),
            ...(request.meaning === undefined
              ? {}
              : { meaning: request.meaning }),
            set_by: "user",
            updated_at: now,
            revision: nextRevision(),
          };
          glossary.set(context, list.map((item, i) => i === at ? next : item));
          return Promise.resolve(ok(next));
        }
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      const created: GlossaryEntry = {
        id: request.id,
        context: request.context,
        term: request.term,
        meaning: request.meaning,
        set_by: "user",
        updated_at: now,
        revision: nextRevision(),
      };
      glossary.set(request.context, [
        ...(glossary.get(request.context) ?? []),
        created,
      ]);
      return Promise.resolve(ok(created));
    },
    glossaryRemove(request, compare) {
      calls.push({ command: "glossaryRemove", request, compare });
      for (const [context, list] of glossary) {
        if (list.some((item) => item.id === request.entry)) {
          glossary.set(
            context,
            list.filter((item) => item.id !== request.entry),
          );
          return Promise.resolve(ok({ entry: request.entry }));
        }
      }
      return Promise.resolve({ ok: false, message: "not_found" });
    },
    handOffViolations(request): Promise<CommandResult<HandOffResult>> {
      calls.push({ command: "handOffViolations", request });
      const all = VIOLATIONS[request.context] ?? [];
      const keys: readonly ViolationKey[] = request.violations ??
        all.map((violation) => ({
          kind: violation.kind,
          rule: violation.rule,
          path: violation.path,
          section: violation.section,
        }));
      const known = new Set(
        (handedOff.get(request.context) ?? []).map(keyOf),
      );
      handedOff.set(request.context, [
        ...(handedOff.get(request.context) ?? []),
        ...keys.filter((key) => !known.has(keyOf(key))),
      ]);
      return Promise.resolve(ok({
        context: request.context,
        run: fakeId("run", `h${calls.length}`),
        violation_count: Math.max(1, keys.length),
      }));
    },
    rollback(request): Promise<CommandResult<RollbackResult>> {
      calls.push({ command: "rollback", request });
      return Promise.resolve({
        ok: false,
        message: "unavailable",
      });
    },
  };
}
