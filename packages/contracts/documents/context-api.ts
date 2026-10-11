// context API 계약: 새 context 모델(docs/domain-model/documents/contexts.md, terms.md)의
// command, 읽기, event와 값의 모양이다. 값의 뜻과 제약은 domain model이 정하고 여기서는 한 값 안에서
// 정해지는 모양과 route 선언만 둔다. 상태 전이, CAS 비교, actor 범위의 세부는 handler의 몫이다.
//
// 옛 contexts.ts·context-routes.ts·context-reads.ts·terms.ts·term-routes.ts와 이름이 겹치지 않게
// route는 `…Route`, event는 `…Event`, 입력은 `…RequestSchema`로 끝낸다. 옛 파일을 지우는 작업이
// 끝나면 접미사를 걷어도 된다.
import { z } from "zod";
import {
  actorSchema,
  atSchema,
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  runIdSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  contractNameSchema,
  contractTypeNameSchema,
  SEARCH_PAGE_SIZE_MAX,
  searchInputValuesSchema,
  searchPathSchema,
} from "./context-contract.ts";
import { publicPage, publicRead, readCursorSchema } from "./read-values.ts";
import {
  projectIdSchema,
  relativePathSchema,
  revisionSchema,
} from "./values.ts";

// ---------- ID ----------

// platform의 ID_PREFIXES에는 아직 cbn·chk가 없다(domain-model platform/ledger는 갖고 있다).
// 같은 모양(접두사 + 소문자 Crockford base32 ULID 26자)으로 여기서 만든다.
const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
function prefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_${ULID}$`));
}

export const ctxIdSchema = idSchema("ctx");
export const bundleIdSchema = prefixedId("cbn");
export const checkIdSchema = prefixedId("chk");
export const savedViewIdSchema = idSchema("viw");
export const glossaryEntryIdSchema = idSchema("trm");

// ---------- 공통 조각 ----------

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveIntSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

// 글자 수는 앞뒤 공백을 자른 뒤 code point로 센다.
function trimmedText(min: number, max: number) {
  return z.string().refine((value) => {
    const length = Array.from(value.trim()).length;
    return length >= min && length <= max;
  }, { message: `expected ${min}-${max} characters after trimming` });
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const blobReferenceSchema = z.strictObject({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

// 판 안의 draft content: 유효한 JSON 객체이면 받는다. BundleContent 스키마 검사는 submit이 한다.
export const draftContentSchema = z.record(z.string(), jsonValueSchema);

// ---------- 값: Context ----------

export const CONTEXT_STATUSES = ["drafting", "active", "archived"] as const;
export const contextStatusSchema = z.enum(CONTEXT_STATUSES);

const contextFields = {
  id: ctxIdSchema,
  project: projectIdSchema,
  title: nonblankSchema,
  purpose: nonblankSchema,
  status: contextStatusSchema,
  applied_bundle: bundleIdSchema.nullable(),
  violation_mark: countSchema,
  revision: revisionSchema,
};
export const contextValueSchema = z.strictObject(contextFields).refine(
  (value) => value.status !== "drafting" || value.applied_bundle === null,
  { message: "a drafting context has no applied bundle" },
).refine(
  (value) => value.status !== "active" || value.applied_bundle !== null,
  { message: "an active context has an applied bundle" },
);
export type ContextValue = z.infer<typeof contextValueSchema>;

// 목록 줄: 판 번호와 진행 중인 판을 같이 보인다(applied_number는 적용 판의 번호).
export const contextListItemSchema = z.strictObject({
  ...contextFields,
  applied_number: positiveIntSchema.nullable(),
  draft_bundle: bundleIdSchema.nullable(),
  checking_bundle: bundleIdSchema.nullable(),
}).refine(
  (value) => value.status !== "drafting" || value.applied_bundle === null,
  { message: "a drafting context has no applied bundle" },
).refine(
  (value) => value.status !== "active" || value.applied_bundle !== null,
  { message: "an active context has an applied bundle" },
).refine(
  (value) =>
    (value.applied_bundle === null) === (value.applied_number === null),
  { message: "applied_number follows applied_bundle" },
);

// ---------- 값: ContextBundle 요약 ----------

export const BUNDLE_STATUSES = [
  "draft",
  "checking",
  "failed",
  "applied",
  "superseded",
  "discarded",
] as const;
export const bundleStatusSchema = z.enum(BUNDLE_STATUSES);

const NUMBERED_BUNDLE_STATUSES = new Set<string>([
  "checking",
  "failed",
  "applied",
  "superseded",
]);

// content blob은 싣지 않는다. 계약 내용은 bundle 읽기가 아니라 content blob 읽기의 몫이다.
export const bundleSummarySchema = z.strictObject({
  id: bundleIdSchema,
  context: ctxIdSchema,
  number: positiveIntSchema.nullable(),
  parent: bundleIdSchema.nullable(),
  bundle_hash: sha256Schema.nullable(),
  status: bundleStatusSchema,
  check: checkIdSchema.nullable(),
  created_by: actorSchema,
  revision: revisionSchema,
}).refine((value) => {
  const numbered = NUMBERED_BUNDLE_STATUSES.has(value.status);
  return numbered
    ? value.number !== null && value.bundle_hash !== null &&
      value.check !== null
    : value.number === null && value.bundle_hash === null &&
      value.check === null;
}, { message: "number, hash and check belong to submitted bundles only" });
export type BundleSummary = z.infer<typeof bundleSummarySchema>;

// ---------- 값: ContextCheck 보고 요약 ----------

export const CHECK_STATUSES = ["running", "passed", "failed"] as const;
export const checkStatusSchema = z.enum(CHECK_STATUSES);

export const CHECK_FINDING_KINDS = [
  "contract_invalid",
  "cross_project_path",
  "private_reference",
  "example_mismatch",
  "saved_view_broken",
  "aborted",
] as const;
export const checkFindingSchema = z.strictObject({
  kind: z.enum(CHECK_FINDING_KINDS),
  target: nonblankSchema.nullable(),
  detail: nonblankSchema,
});
export type CheckFinding = z.infer<typeof checkFindingSchema>;

export const checkReportSchema = z.strictObject({
  id: checkIdSchema,
  context: ctxIdSchema,
  bundle: bundleIdSchema,
  status: checkStatusSchema,
  // snapshot을 뜬 뒤에야 안다. 검사 중에는 null이다.
  snapshot_hash: sha256Schema.nullable(),
  findings: z.array(checkFindingSchema),
  violation_count: countSchema.nullable(),
  started_at: atSchema,
  finished_at: atSchema.nullable(),
}).refine(
  (value) =>
    value.status === "running"
      ? value.finished_at === null && value.violation_count === null &&
        value.findings.length === 0
      : value.finished_at !== null && value.violation_count !== null &&
        value.snapshot_hash !== null,
  { message: "a running check is open; a finished check has its results" },
).refine(
  (value) =>
    value.status === "failed"
      ? value.findings.length >= 1
      : value.findings.length === 0,
  { message: "findings belong to failed checks only, at least one" },
);
export type CheckReport = z.infer<typeof checkReportSchema>;

// ---------- 값: SavedView ----------

export const SAVED_VIEW_ORIGINS = ["user", "engineer"] as const;
const savedViewFields = {
  id: savedViewIdSchema,
  context: ctxIdSchema,
  name: nonblankSchema,
  search: contractNameSchema,
  inputs: searchInputValuesSchema,
  origin: z.enum(SAVED_VIEW_ORIGINS),
  revision: revisionSchema,
};
export const savedViewValueSchema = z.strictObject(savedViewFields);
export type SavedViewValue = z.infer<typeof savedViewValueSchema>;
// 적용된 판에서 호출이 깨진 saved view는 지우지 않고 broken으로 표시한다.
export const savedViewListItemSchema = z.strictObject({
  ...savedViewFields,
  broken: z.boolean(),
});

// ---------- 값: GlossaryEntry ----------

export const GLOSSARY_TERM_MAX = 80;
export const GLOSSARY_MEANING_MAX = 1000;
export const GLOSSARY_ENTRY_MAX = 200;
export const glossaryTermSchema = trimmedText(1, GLOSSARY_TERM_MAX);
export const glossaryMeaningSchema = trimmedText(1, GLOSSARY_MEANING_MAX);
export const GLOSSARY_SET_BY = ["user", "agent"] as const;
export const glossaryEntrySchema = z.strictObject({
  id: glossaryEntryIdSchema,
  context: ctxIdSchema,
  term: glossaryTermSchema,
  meaning: glossaryMeaningSchema,
  set_by: z.enum(GLOSSARY_SET_BY),
  updated_at: atSchema,
  revision: revisionSchema,
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

// ---------- 값: Violation ----------

export const VIOLATION_KINDS = [
  "rule",
  "unreadable",
  "path_mismatch",
  "broken_link",
] as const;
export const violationKindSchema = z.enum(VIOLATION_KINDS);

const violationKeyFields = {
  kind: violationKindSchema,
  // kind가 rule일 때만 있다: `Type.rule id`
  rule: nonblankSchema.nullable(),
  path: relativePathSchema,
  section: nonblankSchema.nullable(),
};
const ruleOnlyForRuleKind = (value: { kind: string; rule: string | null }) =>
  (value.kind === "rule") === (value.rule !== null);
const ruleMessage = { message: "rule is set exactly when kind is rule" };

// 순수 함수(추출·검사)가 내는 모양이다. 문구는 읽기 쪽이 붙인다.
export const violationSchema = z.strictObject({
  ...violationKeyFields,
  type: contractTypeNameSchema.nullable(),
  target: nonblankSchema.nullable(),
}).refine(ruleOnlyForRuleKind, ruleMessage);
export type Violation = z.infer<typeof violationSchema>;

// ledger 밖 derived 표에 담기고 읽기가 돌려주는 모양: 순수 모양 + context, 감지한 판, 문구.
export const storedViolationSchema = z.strictObject({
  context: ctxIdSchema,
  bundle_hash: sha256Schema,
  ...violationKeyFields,
  type: contractTypeNameSchema.nullable(),
  target: nonblankSchema.nullable(),
  message: nonblankSchema,
}).refine(ruleOnlyForRuleKind, ruleMessage);
export type StoredViolation = z.infer<typeof storedViolationSchema>;

// `(context, kind, rule, path, section)` 중 context를 뺀 키. 넘길 위반을 가리킨다.
export const violationKeySchema = z.strictObject(violationKeyFields).refine(
  ruleOnlyForRuleKind,
  ruleMessage,
);
export type ViolationKey = z.infer<typeof violationKeySchema>;

// ---------- command 비교 기준 ----------

export const baseRevisionSchema = z.strictObject({
  base_revision: revisionSchema,
});
// 새로 만들 때는 비교할 revision이 없다. 이미 있는 것을 고칠 때는 handler가 base_revision을
// 요구하고, 새로 만들 때 보내면 거절한다.
export const optionalBaseRevisionSchema = z.strictObject({
  base_revision: revisionSchema.optional(),
});
export const noCompareSchema = z.strictObject({});

// ---------- command 입력과 결과 ----------

export const contextCreateRequestSchema = z.strictObject({
  id: ctxIdSchema,
  project: projectIdSchema,
  title: nonblankSchema,
  purpose: nonblankSchema,
});
export const contextTargetRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
export const contextResultSchema = contextValueSchema;

export const bundleSaveDraftRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 없으면 새 draft, 있으면 그 draft를 덮어쓴다(base_revision 필요)
  bundle: bundleIdSchema.optional(),
  content: draftContentSchema,
});
export const bundleTargetRequestSchema = z.strictObject({
  bundle: bundleIdSchema,
});
export const bundleResultSchema = bundleSummarySchema;

export const bundleFinishCheckRequestSchema = z.strictObject({
  check: checkIdSchema,
  result: z.enum(["passed", "failed"]),
  // worker가 검사한 판의 hash와 snapshot의 hash. 앞의 것은 submit 때 기록한 hash와 맞아야 한다.
  bundle_hash: sha256Schema,
  snapshot_hash: sha256Schema,
  findings: z.array(checkFindingSchema),
  violation_count: countSchema,
}).refine(
  (value) =>
    value.result === "failed"
      ? value.findings.length >= 1
      : value.findings.length === 0,
  { message: "failed needs at least one finding; passed has none" },
);
export const bundleFinishCheckResultSchema = z.strictObject({
  context: contextValueSchema,
  bundle: bundleSummarySchema,
  check: checkReportSchema,
});

export const bundleRollbackRequestSchema = z.strictObject({
  context: ctxIdSchema,
  bundle: bundleIdSchema,
});
export const bundleRollbackResultSchema = z.strictObject({
  context: contextValueSchema,
  bundle: bundleSummarySchema,
});

export const viewSaveRequestSchema = z.strictObject({
  context: ctxIdSchema,
  name: nonblankSchema,
  search: contractNameSchema,
  inputs: searchInputValuesSchema,
});
const viewUpdateFields = {
  name: nonblankSchema.optional(),
  search: contractNameSchema.optional(),
  inputs: searchInputValuesSchema.optional(),
};
export const viewUpdateRequestSchema = z.strictObject({
  view: savedViewIdSchema,
  ...viewUpdateFields,
}).refine(
  (value) =>
    Object.keys(viewUpdateFields).some((field) =>
      value[field as keyof typeof viewUpdateFields] !== undefined
    ),
  { message: "update must change at least one field" },
);
export const viewDeleteRequestSchema = z.strictObject({
  view: savedViewIdSchema,
});
export const viewResultSchema = savedViewValueSchema;
export const viewDeleteResultSchema = z.strictObject({
  view: savedViewIdSchema,
});

export const violationsRecordRequestSchema = z.strictObject({
  context: ctxIdSchema,
  count: countSchema,
  bundle_hash: sha256Schema,
});

export const HAND_OFF_VIOLATIONS_MAX = 200;
export const violationsHandOffRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 없으면 전부. 있으면 키가 겹치지 않는 1개 이상. 근거는 서버가 붙인다.
  violations: z.array(violationKeySchema).min(1).max(HAND_OFF_VIOLATIONS_MAX)
    .refine(
      (keys) =>
        new Set(
          keys.map((key) =>
            JSON.stringify([key.kind, key.rule, key.path, key.section])
          ),
        )
          .size === keys.length,
      { message: "duplicate violation key" },
    ).optional(),
});
export const violationsHandOffResultSchema = z.strictObject({
  context: ctxIdSchema,
  run: runIdSchema,
  violation_count: positiveIntSchema,
});

const glossarySetNewSchema = z.strictObject({
  id: glossaryEntryIdSchema,
  context: ctxIdSchema,
  term: glossaryTermSchema,
  meaning: glossaryMeaningSchema,
});
const glossarySetExistingFields = {
  term: glossaryTermSchema.optional(),
  meaning: glossaryMeaningSchema.optional(),
};
const glossarySetExistingSchema = z.strictObject({
  entry: glossaryEntryIdSchema,
  ...glossarySetExistingFields,
}).refine(
  (value) => value.term !== undefined || value.meaning !== undefined,
  { message: "set must change the term or the meaning" },
);
// 새 항목(id, context, term, meaning) 아니면 기존 항목(entry, term?, meaning?)이다.
export const glossarySetRequestSchema = z.union([
  glossarySetNewSchema,
  glossarySetExistingSchema,
]);
export const glossaryRemoveRequestSchema = z.strictObject({
  entry: glossaryEntryIdSchema,
});
export const glossaryEntryResultSchema = glossaryEntrySchema;
export const glossaryRemoveResultSchema = z.strictObject({
  entry: glossaryEntryIdSchema,
});

// ---------- 읽기 입력과 결과 ----------

export const CONTEXT_PAGE_DEFAULT = 30;
export const CONTEXT_PAGE_MAX = 100;
const pageLimitSchema = z.number().int().min(1).max(CONTEXT_PAGE_MAX);

export const contextListRequestSchema = z.strictObject({
  project: projectIdSchema,
  // 없으면 보관되지 않은 것(drafting, active), all이면 보관된 것까지
  status: z.enum([...CONTEXT_STATUSES, "all"]).optional(),
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
});
// 제목의 code unit 순, 같으면 id 순
export const contextListReadSchema = publicPage(z.object({
  contexts: z.array(contextListItemSchema).max(CONTEXT_PAGE_MAX),
}));

export const contextGetReadSchema = publicRead(z.object({
  context: contextValueSchema,
  applied: bundleSummarySchema
    .refine((bundle) => bundle.status === "applied", {
      message: "the applied bundle has the applied status",
    })
    .nullable(),
}));

// type 이름과 개체 수. 계약의 type 순서를 따른다. 적용된 판이 없으면 비어 있다.
export const contextOverviewReadSchema = publicRead(z.object({
  context: contextValueSchema,
  bundle_hash: sha256Schema.nullable(),
  types: z.array(z.strictObject({
    type: contractTypeNameSchema,
    count: countSchema,
  })),
  violation_count: countSchema,
}));

export const searchRowSchema = z.strictObject({
  key: nonblankSchema,
  path: relativePathSchema,
  section: nonblankSchema.nullable(),
  // 열의 path(`field` 또는 `별칭.field`)를 키로 하는 값. 정렬·묶기·board_by의 path도 싣는다.
  values: z.record(searchPathSchema, jsonValueSchema),
});
export type SearchRow = z.infer<typeof searchRowSchema>;

export const contextSearchRequestSchema = z.strictObject({
  context: ctxIdSchema,
  search: contractNameSchema,
  inputs: searchInputValuesSchema,
  cursor: readCursorSchema.optional(),
  // 선언의 result.page_size(기본 30)를 이 호출에서만 바꾼다
  page_size: z.number().int().min(1).max(SEARCH_PAGE_SIZE_MAX).optional(),
});
export const contextSearchReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  search: contractNameSchema,
  bundle_hash: sha256Schema,
  rows: z.array(searchRowSchema).max(SEARCH_PAGE_SIZE_MAX),
}));

export const contextViolationsRequestSchema = z.strictObject({
  context: ctxIdSchema,
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
});
// path, kind, rule, section의 code unit 순
export const contextViolationsReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  violations: z.array(storedViolationSchema).max(CONTEXT_PAGE_MAX),
}));

export const contextBundlesRequestSchema = z.strictObject({
  context: ctxIdSchema,
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
});
// 판 이력: 번호 내림차순, 번호 없는 draft가 맨 앞이다. 검사 보고가 있으면 같이 싣는다.
export const contextBundlesReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  bundles: z.array(z.strictObject({
    bundle: bundleSummarySchema,
    check: checkReportSchema.nullable(),
  })).max(CONTEXT_PAGE_MAX),
}));

export const contextSavedViewsRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
// 이름의 code unit 순, 같으면 id 순
export const contextSavedViewsReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  views: z.array(savedViewListItemSchema),
}));

export const contextContainingRequestSchema = z.strictObject({
  project: projectIdSchema,
  path: relativePathSchema,
});
// 적용된 판이 있는 활성 context 중 계약의 Source가 이 경로를 덮는 것. 제목, id 순.
export const contextContainingReadSchema = publicRead(z.object({
  contexts: z.array(z.strictObject({
    context: ctxIdSchema,
    title: nonblankSchema,
    types: z.array(contractTypeNameSchema).min(1),
  })),
}));

// 항목 전부를 용어의 ASCII 소문자 byte 순(같으면 id 순)으로 한 번에. cursor·page가 없다.
export const glossaryListRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
export const glossaryListReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  entries: z.array(glossaryEntrySchema).max(GLOSSARY_ENTRY_MAX),
}));

// ---------- route ----------

const AGENT_AND_USER = ["user", "agent"] as const;
// coding agent에게는 context command·읽기 통로가 없다(documents/contexts#R27).
const READ_ACTORS = ["user", "agent"] as const;
const READ_ERRORS = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

export const contextCreateRoute = defineCommand({
  resource: "contexts",
  method: "create",
  name: "context.create",
  input: contextCreateRequestSchema,
  output: contextResultSchema,
  compare: noCompareSchema,
  actors: AGENT_AND_USER,
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const contextArchiveRoute = defineCommand({
  resource: "contexts",
  method: "archive",
  name: "context.archive",
  input: contextTargetRequestSchema,
  output: contextResultSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const contextUnarchiveRoute = defineCommand({
  resource: "contexts",
  method: "unarchive",
  name: "context.unarchive",
  input: contextTargetRequestSchema,
  output: contextResultSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});

export const bundleSaveDraftRoute = defineCommand({
  resource: "contexts",
  method: "save_draft",
  name: "bundle.save_draft",
  input: bundleSaveDraftRequestSchema,
  output: bundleResultSchema,
  compare: optionalBaseRevisionSchema,
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const bundleDiscardDraftRoute = defineCommand({
  resource: "contexts",
  method: "discard_draft",
  name: "bundle.discard_draft",
  input: bundleTargetRequestSchema,
  output: bundleResultSchema,
  compare: baseRevisionSchema,
  actors: AGENT_AND_USER,
  errors: ["not_found", "conflict", "forbidden"],
});
export const bundleSubmitRoute = defineCommand({
  resource: "contexts",
  method: "submit_bundle",
  name: "bundle.submit",
  input: bundleTargetRequestSchema,
  output: bundleResultSchema,
  compare: noCompareSchema,
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
// context worker가 좁은 machine 자격으로 낸다. 통과하면 같은 transaction에서 적용된다.
export const bundleFinishCheckRoute = defineCommand({
  resource: "contexts",
  method: "record_check",
  name: "bundle.finish_check",
  input: bundleFinishCheckRequestSchema,
  output: bundleFinishCheckResultSchema,
  compare: noCompareSchema,
  actors: ["machine"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
// base_revision은 Context의 revision이다: 그 사이 다른 판이 적용되면 거절한다.
export const bundleRollbackRoute = defineCommand({
  resource: "contexts",
  method: "rollback",
  name: "bundle.rollback",
  input: bundleRollbackRequestSchema,
  output: bundleRollbackResultSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});

export const viewSaveRoute = defineCommand({
  resource: "contexts",
  method: "save_view",
  name: "view.save",
  input: viewSaveRequestSchema,
  output: viewResultSchema,
  compare: noCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const viewUpdateRoute = defineCommand({
  resource: "contexts",
  method: "update_view",
  name: "view.update",
  input: viewUpdateRequestSchema,
  output: viewResultSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const viewDeleteRoute = defineCommand({
  resource: "contexts",
  method: "delete_view",
  name: "view.delete",
  input: viewDeleteRequestSchema,
  output: viewDeleteResultSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});

// 위반 수의 마지막 기록. context worker가 좁은 machine 자격으로 낸다.
export const contextRecordViolationsRoute = defineCommand({
  resource: "contexts",
  method: "record_violations",
  name: "context.record_violations",
  input: violationsRecordRequestSchema,
  output: contextResultSchema,
  compare: noCompareSchema,
  actors: ["machine"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const contextHandOffViolationsRoute = defineCommand({
  resource: "contexts",
  method: "hand_off_violations",
  name: "context.hand_off_violations",
  input: violationsHandOffRequestSchema,
  output: violationsHandOffResultSchema,
  compare: noCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "forbidden"],
});

export const glossarySetRoute = defineCommand({
  resource: "terms",
  method: "set",
  name: "glossary.set",
  input: glossarySetRequestSchema,
  output: glossaryEntryResultSchema,
  compare: optionalBaseRevisionSchema,
  actors: AGENT_AND_USER,
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const glossaryRemoveRoute = defineCommand({
  resource: "terms",
  method: "remove",
  name: "glossary.remove",
  input: glossaryRemoveRequestSchema,
  output: glossaryRemoveResultSchema,
  compare: baseRevisionSchema,
  actors: AGENT_AND_USER,
  errors: ["not_found", "conflict", "forbidden"],
});

export const contextListRoute = defineRead({
  resource: "contexts",
  method: "list",
  name: "context.list",
  input: contextListRequestSchema,
  output: contextListReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextGetRoute = defineRead({
  resource: "contexts",
  method: "get",
  name: "context.get",
  input: contextTargetRequestSchema,
  output: contextGetReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextOverviewRoute = defineRead({
  resource: "contexts",
  method: "overview",
  name: "context.overview",
  input: contextTargetRequestSchema,
  output: contextOverviewReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextSearchRoute = defineRead({
  resource: "contexts",
  method: "search",
  name: "context.search",
  input: contextSearchRequestSchema,
  output: contextSearchReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextViolationsRoute = defineRead({
  resource: "contexts",
  method: "violations",
  name: "context.violations",
  input: contextViolationsRequestSchema,
  output: contextViolationsReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextBundlesRoute = defineRead({
  resource: "contexts",
  method: "bundles",
  name: "context.bundles",
  input: contextBundlesRequestSchema,
  output: contextBundlesReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextSavedViewsRoute = defineRead({
  resource: "contexts",
  method: "saved_views",
  name: "context.saved_views",
  input: contextSavedViewsRequestSchema,
  output: contextSavedViewsReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextContainingRoute = defineRead({
  resource: "contexts",
  method: "containing",
  name: "context.containing",
  input: contextContainingRequestSchema,
  output: contextContainingReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const glossaryListRoute = defineRead({
  resource: "terms",
  method: "list",
  name: "glossary.list",
  input: glossaryListRequestSchema,
  output: glossaryListReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});

export const CONTEXT_API_COMMAND_ROUTES = [
  contextCreateRoute,
  contextArchiveRoute,
  contextUnarchiveRoute,
  bundleSaveDraftRoute,
  bundleDiscardDraftRoute,
  bundleSubmitRoute,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  viewSaveRoute,
  viewUpdateRoute,
  viewDeleteRoute,
  contextRecordViolationsRoute,
  contextHandOffViolationsRoute,
  glossarySetRoute,
  glossaryRemoveRoute,
] as const;
export const CONTEXT_API_READ_ROUTES = [
  contextListRoute,
  contextGetRoute,
  contextOverviewRoute,
  contextSearchRoute,
  contextViolationsRoute,
  contextBundlesRoute,
  contextSavedViewsRoute,
  contextContainingRoute,
  glossaryListRoute,
] as const;
export const CONTEXT_API_ROUTES = [
  ...CONTEXT_API_COMMAND_ROUTES,
  ...CONTEXT_API_READ_ROUTES,
] as const;

// ---------- event ----------

export const contextCreatedEvent = defineEvent("ContextCreated", {
  subject: ctxIdSchema,
  payload: z.object({
    project: projectIdSchema,
    title: nonblankSchema,
    purpose: nonblankSchema,
  }),
});
export const contextArchivedEvent = defineEvent("ContextArchived", {
  subject: ctxIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const contextUnarchivedEvent = defineEvent("ContextUnarchived", {
  subject: ctxIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const bundleDraftSavedEvent = defineEvent("ContextBundleDraftSaved", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    parent: bundleIdSchema.nullable(),
    content: blobReferenceSchema,
  }),
});
export const bundleDraftDiscardedEvent = defineEvent(
  "ContextBundleDraftDiscarded",
  { subject: bundleIdSchema, payload: z.object({ context: ctxIdSchema }) },
);
export const bundleSubmittedEvent = defineEvent("ContextBundleSubmitted", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    bundle_hash: sha256Schema,
    check: checkIdSchema,
  }),
});
export const bundleCheckFailedEvent = defineEvent("ContextBundleCheckFailed", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    check: checkIdSchema,
    findings: z.array(checkFindingSchema).min(1),
  }),
});
export const bundleAppliedEvent = defineEvent("ContextBundleApplied", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    previous_applied: bundleIdSchema.nullable(),
    check: checkIdSchema,
    violation_count: countSchema,
  }),
});
export const bundleRolledBackEvent = defineEvent("ContextBundleRolledBack", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    previous_applied: bundleIdSchema,
    before_revision: revisionSchema,
  }),
});
export const savedViewCreatedEvent = defineEvent("SavedViewCreated", {
  subject: savedViewIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    name: nonblankSchema,
    search: contractNameSchema,
    inputs: searchInputValuesSchema,
    origin: z.enum(SAVED_VIEW_ORIGINS),
  }),
});
export const savedViewUpdatedEvent = defineEvent("SavedViewUpdated", {
  subject: savedViewIdSchema,
  payload: z.object({
    before: z.object(viewUpdateFields),
    after: z.object(viewUpdateFields),
    before_revision: revisionSchema,
  }).refine(
    (value) =>
      Object.values(value.before).some((field) => field !== undefined) &&
      Object.values(value.after).some((field) => field !== undefined),
    { message: "update event names the changed fields" },
  ),
});
export const savedViewDeletedEvent = defineEvent("SavedViewDeleted", {
  subject: savedViewIdSchema,
  payload: z.object({
    before_view: savedViewValueSchema,
    before_revision: revisionSchema,
  }),
});
export const contextViolationsRecordedEvent = defineEvent(
  "ContextViolationsRecorded",
  {
    subject: ctxIdSchema,
    payload: z.object({
      before: countSchema,
      after: countSchema,
      bundle_hash: sha256Schema,
    }),
  },
);
export const contextViolationsHandedOffEvent = defineEvent(
  "ContextViolationsHandedOff",
  {
    subject: ctxIdSchema,
    payload: z.object({
      violations: z.array(violationKeySchema).min(1),
      evidence: blobReferenceSchema,
      run: runIdSchema,
    }),
  },
);
export const glossaryEntrySetEvent = defineEvent("GlossaryEntrySet", {
  subject: glossaryEntryIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    term: glossaryTermSchema,
    meaning: glossaryMeaningSchema,
    set_by: z.enum(GLOSSARY_SET_BY),
    created: z.boolean(),
  }),
});
export const glossaryEntryRemovedEvent = defineEvent("GlossaryEntryRemoved", {
  subject: glossaryEntryIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    term: glossaryTermSchema,
  }),
});

export const CONTEXT_API_EVENTS = [
  contextCreatedEvent,
  contextArchivedEvent,
  contextUnarchivedEvent,
  bundleDraftSavedEvent,
  bundleDraftDiscardedEvent,
  bundleSubmittedEvent,
  bundleCheckFailedEvent,
  bundleAppliedEvent,
  bundleRolledBackEvent,
  savedViewCreatedEvent,
  savedViewUpdatedEvent,
  savedViewDeletedEvent,
  contextViolationsRecordedEvent,
  contextViolationsHandedOffEvent,
  glossaryEntrySetEvent,
  glossaryEntryRemovedEvent,
] as const;
