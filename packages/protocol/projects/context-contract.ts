// context 계약 묶음(BundleContent)의 모양.
// 여기서는 한 값 안에서 정해지는 모양만 검사한다. type·field·관계·검색 사이 참조와 series pattern 문법은
// packages/core/projects/contexts/validate/가 검사한다.
import { z } from "zod";
import { relativePathSchema, slugSchema } from "./values.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

export const CONTEXT_SOURCE_KINDS = [
  "folder",
  "docs",
  "series",
  "index",
  "section",
  "outline",
  "app-data",
] as const;
export type ContextSourceKind = typeof CONTEXT_SOURCE_KINDS[number];

export const CONTRACT_VISIBILITIES = ["public", "private"] as const;
export const contractVisibilitySchema = z.enum(CONTRACT_VISIBILITIES);
export type ContractVisibility = z.infer<typeof contractVisibilitySchema>;

// Experiment, Finding
export const contractTypeNameSchema = z.string().regex(/^[A-Z][A-Za-z0-9]*$/);
// question, scenarios, status_date
export const contractNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
// 같은 project의 다른 context의 public type: `<context 제목>/<Type 이름>`(rubrics/Rubric).
// 마지막 `/` 앞이 context의 title이다(documents/contexts "다른 context의 type 참조").
export const externalTypeRefSchema = z.string().regex(
  /^[\s\S]*\S[\s\S]*\/[A-Z][A-Za-z0-9]*$/,
);
// 외부 참조를 context 제목과 Type 이름으로 나눈다. 외부 참조가 아니면 undefined다.
export function splitExternalRef(
  ref: string,
): { context: string; type: string } | undefined {
  if (!externalTypeRefSchema.safeParse(ref).success) return undefined;
  const slash = ref.lastIndexOf("/");
  return { context: ref.slice(0, slash), type: ref.slice(slash + 1) };
}
export const typeRefSchema = z.union([
  contractTypeNameSchema,
  externalTypeRefSchema,
]);

// project 폴더 기준 상대 경로. glob(`*`, `**`, `?`)을 허용한다.
export const pathPatternSchema = relativePathSchema;
const headingLevelSchema = z.number().int().min(1).max(6);

// ---------- Source ----------

export const folderSourceSchema = z.strictObject({
  kind: z.literal("folder"),
  root: relativePathSchema,
  child_pattern: z.string().min(1).default("*"),
  depth: z.literal(1).default(1),
});
export const docsSourceSchema = z.strictObject({
  kind: z.literal("docs"),
  paths: z.array(pathPatternSchema).min(1),
});
// pattern 문법(번호 자리 하나, `*`는 파일 이름 칸)은 documents/series가 정하고 validate/sources가 검사한다.
export const seriesSourceSchema = z.strictObject({
  kind: z.literal("series"),
  pattern: z.string().min(1),
  order: z.literal("natural").default("natural"),
});
export const indexSourceSchema = z.strictObject({
  kind: z.literal("index"),
  document: relativePathSchema,
  within: nonblankSchema.optional(),
});
const documentsOrFromType = (
  value: { documents?: unknown; from_type?: unknown },
) => (value.documents === undefined) !== (value.from_type === undefined);
export const sectionSourceSchema = z.strictObject({
  kind: z.literal("section"),
  documents: z.array(pathPatternSchema).min(1).optional(),
  from_type: contractTypeNameSchema.optional(),
  level: headingLevelSchema,
  title_pattern: z.string().min(1).optional(),
}).refine(documentsOrFromType, {
  message: "expected exactly one of documents or from_type",
});
export const OUTLINE_FORMATS = ["markdown"] as const;
export const outlineSourceSchema = z.strictObject({
  kind: z.literal("outline"),
  documents: z.array(pathPatternSchema).min(1).optional(),
  from_type: contractTypeNameSchema.optional(),
  format: z.enum(OUTLINE_FORMATS),
  min_level: headingLevelSchema.default(1),
  max_level: headingLevelSchema.default(6),
}).refine(documentsOrFromType, {
  message: "expected exactly one of documents or from_type",
}).refine((value) => value.min_level <= value.max_level, {
  message: "min_level must not exceed max_level",
});
export const appDataSourceSchema = z.strictObject({
  kind: z.literal("app-data"),
  app: slugSchema,
  command: nonblankSchema,
  // command 결과에서 항목 배열을 가리키는 key 경로. 빈 배열이면 결과 자체가 배열이다.
  result_path: z.array(z.string().min(1)),
});
export const contractSourceSchema = z.discriminatedUnion("kind", [
  folderSourceSchema,
  docsSourceSchema,
  seriesSourceSchema,
  indexSourceSchema,
  sectionSourceSchema,
  outlineSourceSchema,
  appDataSourceSchema,
]);
export type ContractSource = z.infer<typeof contractSourceSchema>;

// ---------- Field ----------

// path capture 이름: series pattern의 번호 자리(`n`, `major`, `minor`, `patch`), folder의 `folder`,
// 문서가 있는 개체의 `file`(확장자 뺀 파일 이름)과 `path`(project 기준 경로).
export const fieldFromSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("frontmatter"), key: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("yaml"),
    file: relativePathSchema.optional(),
    key_path: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    kind: z.literal("section"),
    heading: nonblankSchema,
    include_children: z.boolean().default(false),
  }),
  z.strictObject({ kind: z.literal("path"), capture: z.string().min(1) }),
  z.strictObject({ kind: z.literal("title") }),
  z.strictObject({
    kind: z.literal("links"),
    within: nonblankSchema.optional(),
    to_type: contractTypeNameSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("outline"), max_level: headingLevelSchema }),
  // app-data 개체(결과 배열의 항목)의 key 경로
  z.strictObject({
    kind: z.literal("item"),
    key_path: z.array(z.string().min(1)).min(1),
  }),
]);
export type FieldFrom = z.infer<typeof fieldFromSchema>;

export const FIELD_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "list",
] as const;
export const fieldValueTypeSchema = z.enum(FIELD_VALUE_TYPES);
export const listItemTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "enum",
]);

export const contractFieldSchema = z.strictObject({
  name: contractNameSchema,
  from: fieldFromSchema,
  value_type: fieldValueTypeSchema,
  values: z.array(nonblankSchema).min(1).optional(),
  item_type: listItemTypeSchema.optional(),
  required: z.boolean().default(false),
  visibility: contractVisibilitySchema.default("private"),
}).refine(
  (field) =>
    (field.value_type === "enum" ||
      (field.value_type === "list" && field.item_type === "enum")) ===
      (field.values !== undefined),
  { message: "values belong to enum fields (or lists of enum) only" },
).refine(
  (field) => (field.value_type === "list") === (field.item_type !== undefined),
  { message: "item_type belongs to list fields only" },
);
export type ContractField = z.infer<typeof contractFieldSchema>;

// ---------- Relation ----------

export const RELATION_CARDINALITIES = ["one", "optional", "many"] as const;
export const contractRelationSchema = z.strictObject({
  name: contractNameSchema,
  label: nonblankSchema,
  to: typeRefSchema,
  via: contractNameSchema,
  cardinality: z.enum(RELATION_CARDINALITIES),
  visibility: contractVisibilitySchema.default("private"),
});
export type ContractRelation = z.infer<typeof contractRelationSchema>;

// ---------- CheckRule ----------

const ruleFields = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  message: nonblankSchema,
};
export const CHECK_RULE_KINDS = [
  "required_field",
  "unique_key",
  "relation_target_exists",
  "enum_value",
  "pattern",
  "count_range",
] as const;
export const checkRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...ruleFields,
    kind: z.literal("required_field"),
    params: z.strictObject({ field: contractNameSchema }),
  }),
  // key가 type 안에서 유일하다. fields를 주면 그 field 값 묶음이 유일하다.
  z.strictObject({
    ...ruleFields,
    kind: z.literal("unique_key"),
    params: z.strictObject({
      fields: z.array(contractNameSchema).min(1).optional(),
    }),
  }),
  z.strictObject({
    ...ruleFields,
    kind: z.literal("relation_target_exists"),
    params: z.strictObject({ relation: contractNameSchema }),
  }),
  z.strictObject({
    ...ruleFields,
    kind: z.literal("enum_value"),
    params: z.strictObject({ field: contractNameSchema }),
  }),
  // field 값(list면 항목마다)이 ECMAScript 정규식에 맞는다.
  z.strictObject({
    ...ruleFields,
    kind: z.literal("pattern"),
    params: z.strictObject({
      field: contractNameSchema,
      regex: z.string().min(1).refine((source) => {
        try {
          new RegExp(source, "u");
          return true;
        } catch {
          return false;
        }
      }, { message: "expected a valid regular expression" }),
    }),
  }),
  // field가 있으면 그 list의 길이, 없으면 type의 개체 수가 범위 안이다.
  z.strictObject({
    ...ruleFields,
    kind: z.literal("count_range"),
    params: z.strictObject({
      field: contractNameSchema.optional(),
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    }).refine((p) => p.min !== undefined || p.max !== undefined, {
      message: "expected min or max",
    }).refine(
      (p) => p.min === undefined || p.max === undefined || p.min <= p.max,
      { message: "min must not exceed max" },
    ),
  }),
]);
export type CheckRule = z.infer<typeof checkRuleSchema>;

// ---------- Type, Contract ----------

function unique<T>(items: readonly T[], key: (item: T) => string): boolean {
  return new Set(items.map(key)).size === items.length;
}

export const contractTypeSchema = z.strictObject({
  name: contractTypeNameSchema,
  summary: nonblankSchema,
  visibility: contractVisibilitySchema.default("private"),
  source: contractSourceSchema,
  key: contractNameSchema,
  fields: z.array(contractFieldSchema).min(1),
  relations: z.array(contractRelationSchema).default([]),
  rules: z.array(checkRuleSchema).default([]),
}).refine((type) => unique(type.fields, (field) => field.name), {
  message: "field names must be unique",
  path: ["fields"],
}).refine((type) => unique(type.relations, (relation) => relation.name), {
  message: "relation names must be unique",
  path: ["relations"],
}).refine((type) => unique(type.rules, (rule) => rule.id), {
  message: "rule ids must be unique",
  path: ["rules"],
});
export type ContractType = z.infer<typeof contractTypeSchema>;

export const contractSchema = z.strictObject({
  types: z.array(contractTypeSchema).min(1),
}).refine((contract) => unique(contract.types, (type) => type.name), {
  message: "type names must be unique",
  path: ["types"],
});
export type Contract = z.infer<typeof contractSchema>;

// ---------- DeclaredSearch ----------

// field 이름 하나(시작 type) 또는 `별칭.field`. `key`와 `path`는 모든 개체가 가진 field다.
export const searchPathSchema = z.string().regex(
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/,
);

export const SEARCH_INPUT_TYPES = ["entity", "value", "range", "text"] as const;
export const searchInputSchema = z.strictObject({
  name: contractNameSchema,
  label: nonblankSchema,
  type: z.enum(SEARCH_INPUT_TYPES),
  // entity: Type 이름, value·range: `Type.field`, text: 없음
  of: z.string().regex(/^[A-Z][A-Za-z0-9]*(?:\.[a-z][a-z0-9_]*)?$/)
    .optional(),
  many: z.boolean().default(false),
  required: z.boolean().default(false),
}).refine((input) => (input.type === "text") === (input.of === undefined), {
  message: "of is required for entity, value and range inputs only",
});
export type SearchInput = z.infer<typeof searchInputSchema>;

const literalSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const conditionValueSchema = z.union([
  literalSchema,
  z.array(literalSchema),
  z.strictObject({ input: contractNameSchema }),
]);
export const CONDITION_OPS = [
  "eq",
  "ne",
  "in",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "exists",
] as const;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
    path: string;
    op: typeof CONDITION_OPS[number];
    value?: z.infer<typeof conditionValueSchema>;
  };
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({
      path: searchPathSchema,
      op: z.enum(CONDITION_OPS),
      value: conditionValueSchema.optional(),
    }).refine((c) => (c.op === "exists") === (c.value === undefined), {
      message: "exists takes no value; other ops need one",
    }),
  ])
);

export const searchFollowSchema = z.strictObject({
  relation: contractNameSchema,
  as: contractNameSchema,
  // 따라갈 출발 별칭. 없으면 시작 type이다.
  from: contractNameSchema.optional(),
  direction: z.enum(["forward", "reverse"]),
  where: conditionSchema.optional(),
});
export type SearchFollow = z.infer<typeof searchFollowSchema>;

// follow 한 칸이 닿는 type의 참조: 같은 계약은 `Type`, 다른 context는 `context/Type`.
// `from`은 출발 type의 참조다. forward는 출발 type이 선언한 relation의 `to`이고, reverse는 그
// relation을 `from`으로 선언한 첫 type이다. 풀 수 없으면(없는 relation, 외부 type에서의 forward) undefined다.
export function followedTypeRef(
  types: readonly ContractType[],
  from: string,
  follow: Pick<SearchFollow, "relation" | "direction">,
): string | undefined {
  if (follow.direction === "forward") {
    return types.find((type) => type.name === from)?.relations.find(
      (relation) => relation.name === follow.relation,
    )?.to;
  }
  return types.find((type) =>
    type.relations.some((relation) =>
      relation.name === follow.relation && relation.to === from
    )
  )?.name;
}

export const searchQuerySchema = z.strictObject({
  from: contractTypeNameSchema,
  where: conditionSchema.nullable().default(null),
  follow: z.array(searchFollowSchema).default([]),
  sort: z.array(z.strictObject({
    path: searchPathSchema,
    dir: z.enum(["asc", "desc"]).default("asc"),
  })).default([]),
  group: z.strictObject({ by: searchPathSchema }).nullable().default(null),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const SEARCH_PAGE_SIZE_DEFAULT = 30;
export const SEARCH_PAGE_SIZE_MAX = 100;
export const resultViewSchema = z.strictObject({
  kind: z.enum(["table", "board"]),
  columns: z.array(z.strictObject({
    label: nonblankSchema,
    path: searchPathSchema,
  })).default([]),
  board_by: searchPathSchema.optional(),
  page_size: z.number().int().min(1).max(SEARCH_PAGE_SIZE_MAX).default(
    SEARCH_PAGE_SIZE_DEFAULT,
  ),
}).refine((view) => view.kind !== "table" || view.columns.length > 0, {
  message: "a table needs at least one column",
}).refine((view) => (view.kind === "board") === (view.board_by !== undefined), {
  message: "board_by belongs to boards only",
});
export type ResultView = z.infer<typeof resultViewSchema>;

export const declaredSearchSchema = z.strictObject({
  name: contractNameSchema,
  title: nonblankSchema,
  inputs: z.array(searchInputSchema).default([]),
  query: searchQuerySchema,
  result: resultViewSchema,
}).refine((search) => unique(search.inputs, (input) => input.name), {
  message: "input names must be unique",
  path: ["inputs"],
}).refine(
  (search) => unique(search.query.follow, (follow) => follow.as),
  { message: "follow aliases must be unique", path: ["query", "follow"] },
);
export type DeclaredSearch = z.infer<typeof declaredSearchSchema>;

// ---------- Example, SavedViewDef, BundleContent ----------

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    literalSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
export const searchInputValuesSchema = z.record(
  contractNameSchema,
  jsonValueSchema,
);

export const contractExampleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("search"),
    search: contractNameSchema,
    inputs: searchInputValuesSchema.default({}),
    expect_keys: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("entity"),
    path: relativePathSchema,
    section: z.string().min(1).nullable().default(null),
    expect: z.strictObject({
      type: contractTypeNameSchema,
      key: z.string().min(1),
      fields: z.record(contractNameSchema, jsonValueSchema).optional(),
    }),
  }),
]);
export type ContractExample = z.infer<typeof contractExampleSchema>;

export const savedViewDefSchema = z.strictObject({
  name: nonblankSchema,
  search: contractNameSchema,
  inputs: searchInputValuesSchema.default({}),
});
export type SavedViewDef = z.infer<typeof savedViewDefSchema>;

export const BUNDLE_CONTENT_SCHEMA = 1;
export const bundleContentSchema = z.strictObject({
  schema: z.literal(BUNDLE_CONTENT_SCHEMA),
  contract: contractSchema,
  searches: z.array(declaredSearchSchema).default([]),
  saved_views: z.array(savedViewDefSchema).default([]),
  examples: z.array(contractExampleSchema).default([]),
}).refine((bundle) => unique(bundle.searches, (search) => search.name), {
  message: "search names must be unique",
  path: ["searches"],
}).refine((bundle) => unique(bundle.saved_views, (view) => view.name.trim()), {
  message: "saved view names must be unique",
  path: ["saved_views"],
});
export type BundleContent = z.infer<typeof bundleContentSchema>;
export type BundleContentInput = z.input<typeof bundleContentSchema>;
