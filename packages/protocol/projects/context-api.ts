// context API 계약: 새 context 모델의
// command, 읽기, event와 값의 모양이다. 값의 뜻과 제약은 domain model이 정하고 여기서는 한 값 안에서
// 정해지는 모양과 route 선언만 둔다. 상태 전이, CAS 비교, actor 범위의 세부는 handler의 몫이다.
//
// 옛 contexts.ts·context-routes.ts·context-reads.ts·terms.ts·term-routes.ts와 이름이 겹치지 않게
// route는 `…Route`, event는 `…Event`, 입력은 `…RequestSchema`로 끝낸다. 옛 파일을 지우는 작업이
// 끝나면 접미사를 걷어도 된다.
import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import {
  bundleContentSchema,
  contractNameSchema,
  contractTypeNameSchema,
  SEARCH_PAGE_SIZE_MAX,
  searchInputValuesSchema,
  searchPathSchema,
} from "./context-contract.ts";
import { publicPage, publicRead, readCursorSchema } from "./read-values.ts";
import {
  absolutePathSchema,
  appIdSchema,
  projectIdSchema,
  relativePathSchema,
  revisionSchema,
} from "./values.ts";

// ---------- ID ----------

export const ctxIdSchema = idSchema("ctx");
export const bundleIdSchema = idSchema("cbn");
export const checkIdSchema = idSchema("chk");
const savedViewIdSchema = idSchema("viw");
const glossaryEntryIdSchema = idSchema("trm");

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
const draftContentSchema = z.record(z.string(), jsonValueSchema);

// ---------- 값: Context ----------

const CONTEXT_STATUSES = ["drafting", "active", "archived"] as const;
const contextStatusSchema = z.enum(CONTEXT_STATUSES);

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

const BUNDLE_STATUSES = [
  "draft",
  "checking",
  "failed",
  "applied",
  "superseded",
  "discarded",
] as const;
const bundleStatusSchema = z.enum(BUNDLE_STATUSES);

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

const CHECK_STATUSES = ["running", "passed", "failed"] as const;
const checkStatusSchema = z.enum(CHECK_STATUSES);

const CHECK_FINDING_KINDS = [
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

// saved view를 만든 쪽. 값 schema와 SavedViewCreated가 이것을 쓴다.
const SAVED_VIEW_AUTHORS = ["user", "project_manager"] as const;
const savedViewFields = {
  id: savedViewIdSchema,
  context: ctxIdSchema,
  name: nonblankSchema,
  search: contractNameSchema,
  inputs: searchInputValuesSchema,
  origin: z.enum(SAVED_VIEW_AUTHORS),
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

const GLOSSARY_TERM_MAX = 80;
const GLOSSARY_MEANING_MAX = 1000;
export const GLOSSARY_ENTRY_MAX = 200;
const glossaryTermSchema = trimmedText(1, GLOSSARY_TERM_MAX);
const glossaryMeaningSchema = trimmedText(1, GLOSSARY_MEANING_MAX);
const GLOSSARY_SET_BY = ["user", "project_manager"] as const;
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

const VIOLATION_KINDS = [
  "rule",
  "unreadable",
  "path_mismatch",
  "broken_link",
] as const;
const violationKindSchema = z.enum(VIOLATION_KINDS);

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

// ledger 밖 derived 표에 담기는 모양: 순수 모양 + context, 감지한 판, 문구.
const storedViolationFields = {
  context: ctxIdSchema,
  bundle_hash: sha256Schema,
  ...violationKeyFields,
  type: contractTypeNameSchema.nullable(),
  target: nonblankSchema.nullable(),
  message: nonblankSchema,
};
const storedViolationSchema = z.strictObject(storedViolationFields)
  .refine(ruleOnlyForRuleKind, ruleMessage);
export type StoredViolation = z.infer<typeof storedViolationSchema>;

// 읽기가 돌려주는 줄.
const violationItemSchema = z.strictObject({
  ...storedViolationFields,
}).refine(ruleOnlyForRuleKind, ruleMessage);
export type ViolationItem = z.infer<typeof violationItemSchema>;

// `(context, kind, rule, path, section)` 중 context를 뺀 키. 넘길 위반을 가리킨다.

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
const contextTargetRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
const contextResultSchema = contextValueSchema;

const bundleTargetRequestSchema = z.strictObject({
  bundle: bundleIdSchema,
});
const bundleResultSchema = bundleSummarySchema;

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
const bundleFinishCheckResultSchema = z.strictObject({
  context: contextValueSchema,
  bundle: bundleSummarySchema,
  check: checkReportSchema,
});

const bundleRollbackRequestSchema = z.strictObject({
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
const viewUpdateRequestSchema = z.strictObject({
  view: savedViewIdSchema,
  ...viewUpdateFields,
}).refine(
  (value) =>
    Object.keys(viewUpdateFields).some((field) =>
      value[field as keyof typeof viewUpdateFields] !== undefined
    ),
  { message: "update must change at least one field" },
);
const viewDeleteRequestSchema = z.strictObject({
  view: savedViewIdSchema,
});
const viewResultSchema = savedViewValueSchema;
const viewDeleteResultSchema = z.strictObject({
  view: savedViewIdSchema,
});

export const violationsRecordRequestSchema = z.strictObject({
  context: ctxIdSchema,
  count: countSchema,
  bundle_hash: sha256Schema,
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
const glossaryEntryResultSchema = glossaryEntrySchema;
const glossaryRemoveResultSchema = z.strictObject({
  entry: glossaryEntryIdSchema,
});

// ---------- 읽기 입력과 결과 ----------

export const CONTEXT_PAGE_DEFAULT = 30;
export const CONTEXT_PAGE_MAX = 100;
const pageLimitSchema = z.number().int().min(1).max(CONTEXT_PAGE_MAX);

// project와 app 중 정확히 하나로 거른다. app은 적용된 판이 그 앱을 app-data Source로 읽는 context다.
const contextListRequestSchema = z.strictObject({
  project: projectIdSchema.optional(),
  app: appIdSchema.optional(),
  // 없으면 보관되지 않은 것(drafting, active), all이면 보관된 것까지
  status: z.enum([...CONTEXT_STATUSES, "all"]).optional(),
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
}).refine(
  (value) => (value.project === undefined) !== (value.app === undefined),
  { message: "expected exactly one of project and app" },
);
// 제목의 code unit 순, 같으면 id 순
const contextListReadSchema = publicPage(z.object({
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

// 개체를 가리키는 값. 이 ref로 그 파일(+ section)을 연다. context는 다른 context의 개체를 가리킬 때만 있고
// (`context.entity`의 다른 context 관계 대상) 그 context의 ID다. 없으면 ref를 준 context의 개체다.
const entityRefSchema = z.strictObject({
  context: ctxIdSchema.optional(),
  type: contractTypeNameSchema,
  key: nonblankSchema,
  path: relativePathSchema,
  section: nonblankSchema.nullable(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

// 열 하나의 값. path는 열의 path(`field` 또는 `별칭.field`)이고, field가 key이면 ref가 그 개체
// (시작 개체 또는 별칭 개체)이고 아니면 null이다. 열이 아닌 묶기·board_by path도 값을 싣는다.
const searchCellSchema = z.strictObject({
  path: searchPathSchema,
  value: jsonValueSchema,
  ref: entityRefSchema.nullable(),
});
export type SearchCell = z.infer<typeof searchCellSchema>;

// 선언 검색 실행기의 결과 행과 같은 모양이다: 시작 개체의 ref와 열마다 하나의 cell(열 순서).
const searchRowSchema = z.strictObject({
  ref: entityRefSchema,
  cells: z.array(searchCellSchema),
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
  // 조건에 맞는 행 전부의 수(page와 상관없이). board도 lane 자르기 전의 전체다.
  total: countSchema,
  rows: z.array(searchRowSchema).max(SEARCH_PAGE_SIZE_MAX),
}));

const contextContractRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 없으면 적용된 판이다. 있으면 그 context의 submit된 이후 판(checking, failed, applied, superseded)이다.
  bundle: bundleIdSchema.optional(),
});
// 읽은 판의 내용(계약, 검색, saved view 정의, 예). bundle 지정이 없고 적용된 판이 없으면 bundle,
// bundle_hash, content가 모두 null이다.
export const contextContractReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  bundle: bundleIdSchema.nullable(),
  bundle_hash: sha256Schema.nullable(),
  content: bundleContentSchema.nullable(),
}));

// 만드는 중(drafting) context의 진행이다. drafting이 아닌 context는 draft가 null이다. 단계는 1 읽기
// (아직 판이 없다), 2 초안(draft 또는 failed 판), 3 검사(checking 판)다. 적용되면 context가 active가
// 되므로 4는 이 읽기에 없다. bundle·content·check는 그 단계에 아직 없으면 null이다.
const contextDraftReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  draft: z.strictObject({
    step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    // 지금 보는 판: draft, 없으면 검사 중인 판, 없으면 마지막 failed 판.
    bundle: bundleSummarySchema.nullable(),
    // 그 판의 내용. BundleContent 검사는 submit이 하므로 draft 단계에서는 JSON 객체일 뿐이다.
    content: draftContentSchema.nullable(),
    check: checkReportSchema.nullable(),
    // 열린 초안(draft 판)의 폴더. 그 밖의 판(검사 중, 실패)과 판이 아직 없는 단계는 null이다.
    folder: absolutePathSchema.nullable(),
  }).nullable(),
}));

export const INPUT_OPTIONS_DEFAULT = 50;
const INPUT_OPTIONS_MAX = 200;
const INPUT_OPTIONS_PREFIX_MAX = 200;
export const contextInputOptionsRequestSchema = z.strictObject({
  context: ctxIdSchema,
  search: contractNameSchema,
  // 검색 선언의 입력 이름. entity 또는 value 입력이어야 한다.
  input: contractNameSchema,
  // 사람이 친 앞부분. 후보의 value 글이나 label이 이것으로 시작하는 것만(ASCII 대소문자 무시).
  prefix: z.string().max(INPUT_OPTIONS_PREFIX_MAX).optional(),
  limit: z.number().int().min(1).max(INPUT_OPTIONS_MAX).optional(),
});
const optionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
// entity: value는 개체 key, label은 title(없으면 key)이고 key의 code unit 순이다.
// value: value는 field의 서로 다른 값이고 enum이면 선언한 값 순서가 앞, 그다음 나머지 값의 순서이며
// label은 값을 글로 한 것이다. complete가 false이면 limit 때문에 뒤의 후보를 잘랐다.
export const contextInputOptionsReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  search: contractNameSchema,
  input: contractNameSchema,
  options: z.array(z.strictObject({
    value: optionValueSchema,
    label: nonblankSchema,
  })).max(INPUT_OPTIONS_MAX),
  complete: z.boolean(),
}));

const contextViolationsRequestSchema = z.strictObject({
  context: ctxIdSchema,
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
});
// path, kind, rule, section의 code unit 순.
export const contextViolationsReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  violations: z.array(violationItemSchema).max(CONTEXT_PAGE_MAX),
}));

const contextBundlesRequestSchema = z.strictObject({
  context: ctxIdSchema,
  cursor: readCursorSchema.optional(),
  limit: pageLimitSchema.optional(),
});
// 판 이력: 번호 내림차순, 번호 없는 draft가 맨 앞이다. 검사 보고가 있으면 같이 싣는다.
const contextBundlesReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  bundles: z.array(z.strictObject({
    bundle: bundleSummarySchema,
    check: checkReportSchema.nullable(),
  })).max(CONTEXT_PAGE_MAX),
}));

const contextSavedViewsRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
// 이름의 code unit 순, 같으면 id 순
const contextSavedViewsReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  views: z.array(savedViewListItemSchema),
}));

const contextContainingRequestSchema = z.strictObject({
  project: projectIdSchema,
  path: relativePathSchema,
});
// 적용된 판이 있는 활성 context 중 계약의 Source가 이 경로를 덮는 것. 제목, id 순.
const contextContainingReadSchema = publicRead(z.object({
  contexts: z.array(z.strictObject({
    context: ctxIdSchema,
    title: nonblankSchema,
    types: z.array(contractTypeNameSchema).min(1),
  })),
}));

// 항목 전부를 용어의 ASCII 소문자 byte 순(같으면 id 순)으로 한 번에. cursor·page가 없다.
const glossaryListRequestSchema = z.strictObject({
  context: ctxIdSchema,
});
const glossaryListReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  entries: z.array(glossaryEntrySchema).max(GLOSSARY_ENTRY_MAX),
}));

// ---------- 읽기: preview · entity · series_next ----------
//
// 값의 뜻은 contexts.md "읽기"의 preview·entity·series_next다. preview는 파일을 읽으므로 ledger 읽기가
// 아니라 core가 context worker에 일을 보내 답한다(packages/core/projects/contexts/connection.ts).

export const CONTEXT_PREVIEW_PAGE = 30;
const contextPreviewRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 만드는 중인(draft 상태) 판
  bundle: bundleIdSchema,
  cursor: readCursorSchema.optional(),
});
// 위반 한 줄. 저장된 위반에서 context·감지한 판(bundle_hash)만 뺀 것이다.
const previewViolationSchema = z.strictObject({
  ...violationKeyFields,
  type: contractTypeNameSchema.nullable(),
  target: nonblankSchema.nullable(),
  message: nonblankSchema,
}).refine(ruleOnlyForRuleKind, ruleMessage);
// types는 지금 파일에서 뽑은 type별 개체 수(계약의 type 순서). 모양·의미 검사에서 멈추면 비어 있고
// violation_count는 0이다. 위반은 path, kind, rule, section의 code unit 순이고 page는 30개다.
// findings는 매 page에 같다.
const contextPreviewReadSchema = publicPage(z.object({
  context: ctxIdSchema,
  bundle: bundleIdSchema,
  types: z.array(z.strictObject({
    type: contractTypeNameSchema,
    count: countSchema,
  })),
  violation_count: countSchema,
  violations: z.array(previewViolationSchema).max(CONTEXT_PREVIEW_PAGE),
  findings: z.array(checkFindingSchema),
}));
export type ContextPreviewRead = z.infer<typeof contextPreviewReadSchema>;

const contextEntityRequestSchema = z.strictObject({
  context: ctxIdSchema,
  type: contractTypeNameSchema,
  key: nonblankSchema,
});
// 적용된 판의 index에서 읽은 개체 하나. fields는 선언한 field 전부(값이 없으면 null, list는 배열)이고
// relations는 type이 선언한 관계 전부를 선언 순서로 싣는다. targets는 간선 순서이고 닿는 개체가 없으면 비어 있다.
const contextEntityReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  bundle_hash: sha256Schema,
  ref: entityRefSchema,
  fields: z.record(z.string(), jsonValueSchema),
  relations: z.array(z.strictObject({
    name: contractNameSchema,
    label: nonblankSchema,
    targets: z.array(entityRefSchema),
  })),
}));

const contextSeriesNextRequestSchema = z.strictObject({
  context: ctxIdSchema,
  type: contractTypeNameSchema,
});
// documents/series의 다음 이름. key가 빈 문자열이면 path가 null(계산 불가), path에 `*`가 남아 있으면
// complete가 false다. taken은 계산한 key를 가진 멤버가 이미 있다는 뜻이다.
const seriesNextSchema = z.strictObject({
  key: z.string(),
  path: relativePathSchema.nullable(),
  from: relativePathSchema.nullable(),
  complete: z.boolean(),
  taken: z.boolean(),
}).refine((next) => (next.key === "") === (next.path === null), {
  message: "key is empty exactly when there is no path",
}).refine(
  (next) => next.complete === (next.path !== null && !next.path.includes("*")),
  { message: "complete means a path without a * place" },
).refine((next) => !next.taken || next.path !== null, {
  message: "taken needs a computed name",
});
const contextSeriesNextReadSchema = publicRead(z.object({
  context: ctxIdSchema,
  type: contractTypeNameSchema,
  // type의 series pattern
  pattern: nonblankSchema,
  next: seriesNextSchema,
}));

// ---------- route ----------

const AGENT_AND_USER = ["user", "agent"] as const;
// coding agent에게는 context command·읽기 통로가 없다.
const READ_ACTORS = ["user", "agent"] as const;
// agent runtime의 machine 자격만 run 시작 전 tool 정의·prompt 자료를 만들 재료로 list·get·contract를 읽는다.
// 어느 machine이 읽는지는 handler가 principal로 가린다(documents/contexts 읽기).
const RUNTIME_READ_ACTORS = ["user", "agent", "machine"] as const;
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
  actors: RUNTIME_READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextGetRoute = defineRead({
  resource: "contexts",
  method: "get",
  name: "context.get",
  input: contextTargetRequestSchema,
  output: contextGetReadSchema,
  actors: RUNTIME_READ_ACTORS,
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
export const contextContractRoute = defineRead({
  resource: "contexts",
  method: "contract",
  name: "context.contract",
  input: contextContractRequestSchema,
  output: contextContractReadSchema,
  actors: RUNTIME_READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextDraftRoute = defineRead({
  resource: "contexts",
  method: "draft",
  name: "context.draft",
  input: contextTargetRequestSchema,
  output: contextDraftReadSchema,
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
export const contextInputOptionsRoute = defineRead({
  resource: "contexts",
  method: "input_options",
  name: "context.input_options",
  input: contextInputOptionsRequestSchema,
  output: contextInputOptionsReadSchema,
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

export const contextPreviewRoute = defineRead({
  resource: "contexts",
  method: "preview",
  name: "context.preview",
  input: contextPreviewRequestSchema,
  output: contextPreviewReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextEntityRoute = defineRead({
  resource: "contexts",
  method: "entity",
  name: "context.entity",
  input: contextEntityRequestSchema,
  output: contextEntityReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});
export const contextSeriesNextRoute = defineRead({
  resource: "contexts",
  method: "series_next",
  name: "context.series_next",
  input: contextSeriesNextRequestSchema,
  output: contextSeriesNextReadSchema,
  actors: READ_ACTORS,
  errors: READ_ERRORS,
});

const CONTEXT_API_COMMAND_ROUTES = [
  contextCreateRoute,
  contextArchiveRoute,
  contextUnarchiveRoute,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  viewSaveRoute,
  viewUpdateRoute,
  viewDeleteRoute,
  contextRecordViolationsRoute,
  glossarySetRoute,
  glossaryRemoveRoute,
] as const;
const CONTEXT_API_READ_ROUTES = [
  contextListRoute,
  contextGetRoute,
  contextOverviewRoute,
  contextContractRoute,
  contextDraftRoute,
  contextSearchRoute,
  contextInputOptionsRoute,
  contextViolationsRoute,
  contextBundlesRoute,
  contextSavedViewsRoute,
  contextPreviewRoute,
  contextEntityRoute,
  contextSeriesNextRoute,
  contextContainingRoute,
  glossaryListRoute,
] as const;
export const CONTEXT_API_ROUTES = [
  ...CONTEXT_API_COMMAND_ROUTES,
  ...CONTEXT_API_READ_ROUTES,
] as const;

// ---------- event ----------

const contextCreatedEvent = defineEvent("ContextCreated", {
  subject: ctxIdSchema,
  payload: z.object({
    project: projectIdSchema,
    title: nonblankSchema,
    purpose: nonblankSchema,
  }),
});
const contextArchivedEvent = defineEvent("ContextArchived", {
  subject: ctxIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
const contextUnarchivedEvent = defineEvent("ContextUnarchived", {
  subject: ctxIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
const bundleDraftSavedEvent = defineEvent("ContextBundleDraftSaved", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    parent: bundleIdSchema.nullable(),
    content: blobReferenceSchema,
  }),
});
const bundleDraftDiscardedEvent = defineEvent(
  "ContextBundleDraftDiscarded",
  { subject: bundleIdSchema, payload: z.object({ context: ctxIdSchema }) },
);
const bundleSubmittedEvent = defineEvent("ContextBundleSubmitted", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    bundle_hash: sha256Schema,
    check: checkIdSchema,
  }),
});
const bundleCheckFailedEvent = defineEvent("ContextBundleCheckFailed", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    check: checkIdSchema,
    findings: z.array(checkFindingSchema).min(1),
  }),
});
const bundleAppliedEvent = defineEvent("ContextBundleApplied", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    previous_applied: bundleIdSchema.nullable(),
    check: checkIdSchema,
    violation_count: countSchema,
  }),
});
const bundleRolledBackEvent = defineEvent("ContextBundleRolledBack", {
  subject: bundleIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    number: positiveIntSchema,
    previous_applied: bundleIdSchema,
    before_revision: revisionSchema,
  }),
});
const savedViewCreatedEvent = defineEvent("SavedViewCreated", {
  subject: savedViewIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    name: nonblankSchema,
    search: contractNameSchema,
    inputs: searchInputValuesSchema,
    origin: z.enum(SAVED_VIEW_AUTHORS),
  }),
});
const savedViewUpdatedEvent = defineEvent("SavedViewUpdated", {
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
const savedViewDeletedEvent = defineEvent("SavedViewDeleted", {
  subject: savedViewIdSchema,
  payload: z.object({
    before_view: savedViewValueSchema,
    before_revision: revisionSchema,
  }),
});
const glossaryEntrySetEvent = defineEvent("GlossaryEntrySet", {
  subject: glossaryEntryIdSchema,
  payload: z.object({
    context: ctxIdSchema,
    term: glossaryTermSchema,
    meaning: glossaryMeaningSchema,
    set_by: z.enum(GLOSSARY_SET_BY),
    created: z.boolean(),
  }),
});
const glossaryEntryRemovedEvent = defineEvent("GlossaryEntryRemoved", {
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
  glossaryEntrySetEvent,
  glossaryEntryRemovedEvent,
] as const;
export * from "./context-api-content.ts";
