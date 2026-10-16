// context 화면들이 읽고 보내는 통로. 값의 모양은 documents/contexts의
// context API 계약(context-api.ts, context-contract.ts)이 정하고, 이 파일은 type만 가져온다
// (`import type`은 번들에 들어가지 않는다). core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
// 읽기와 명령은 workspace/source.ts의 ReadResult로 성공·실패 이유를 돌려준다.
import type { z } from "zod";
import type {
  BundleContent,
  DeclaredSearch,
} from "../../../../protocol/projects/context-contract.ts";
import type {
  bundleRollbackResultSchema,
  BundleSummary,
  CheckReport,
  contextContractReadSchema,
  contextGetReadSchema,
  contextInputOptionsReadSchema,
  contextInputOptionsRequestSchema,
  contextListItemSchema,
  contextOverviewReadSchema,
  contextSearchReadSchema,
  contextSearchRequestSchema,
  ContextValue,
  contextViolationsReadSchema,
  GlossaryEntry,
  glossaryRemoveRequestSchema,
  glossarySetRequestSchema,
  savedViewListItemSchema,
  SavedViewValue,
  SearchCell,
  SearchRow,
  StoredViolation,
  viewSaveRequestSchema,
  ViolationItem,
  ViolationKey,
  violationsHandOffRequestSchema,
  violationsHandOffResultSchema,
} from "../../../../protocol/projects/context-api.ts";
import type { searchInputValuesSchema } from "../../../../protocol/projects/context-contract.ts";
import type { ReadResult } from "../source.ts";

export type { ReadResult };
export type {
  BundleContent,
  BundleSummary,
  CheckReport,
  ContextValue,
  DeclaredSearch,
  GlossaryEntry,
  SavedViewValue,
  SearchCell,
  SearchRow,
  StoredViolation,
  ViolationItem,
  ViolationKey,
};
export type ContextListItem = z.infer<typeof contextListItemSchema>;
export type SavedViewListItem = z.infer<typeof savedViewListItemSchema>;

/** 명령 결과도 읽기와 같은 모양이다. 실패는 사람에게 보일 이유 글을 가진다. */
export type CommandResult<T> = ReadResult<T>;

/** 선언된 검색의 입력 이름 → 채운 값. 문자열·숫자·문자열 목록·범위 `{from, to}`. */
export type SearchInputValues = z.infer<typeof searchInputValuesSchema>;

/** contexts.get: context 하나와 적용된 판. */
export type ContextDetail = Pick<
  z.infer<typeof contextGetReadSchema>,
  "context" | "applied"
>;

/** contexts.overview: 개체 종류와 개수, 위반 수. 순서는 계약의 type 순서다. */
export type ContextOverview = Pick<
  z.infer<typeof contextOverviewReadSchema>,
  "context" | "bundle_hash" | "types" | "violation_count"
>;

/** 판 이력의 한 줄: 판과 그 검사 보고. 번호 내림차순, 번호 없는 draft가 맨 앞이다. 판의 시각은 검사 보고의 시각이다. */
export interface BundleEntry {
  readonly bundle: BundleSummary;
  readonly check: CheckReport | null;
}

export type SearchRequest = z.infer<typeof contextSearchRequestSchema>;

/** context.search의 한 page: 줄(ref와 cells), 이어 읽을 cursor, 조건에 맞는 전체 줄 수(`total`). */
export type SearchPage = Pick<
  z.infer<typeof contextSearchReadSchema>,
  "rows" | "complete" | "next_cursor" | "total"
>;

/** context.contract: 적용된 판의 계약 내용. 적용된 판이 없으면 bundle, bundle_hash, content가 null이다. */
export type ContextContract = Pick<
  z.infer<typeof contextContractReadSchema>,
  "context" | "bundle" | "bundle_hash" | "content"
>;

/**
 * context.input_options: 입력 form의 combobox와 chip이 보이는 후보. value는 문자열·숫자·불리언이고
 * 질의에는 그 타입 그대로 보낸다. 화면에는 label을 보인다.
 */
export type InputOptions = Pick<
  z.infer<typeof contextInputOptionsReadSchema>,
  "search" | "input" | "options" | "complete"
>;
export type PickOption = InputOptions["options"][number];
export type OptionValue = PickOption["value"];

export type InputOptionsRequest = Pick<
  z.infer<typeof contextInputOptionsRequestSchema>,
  "context" | "search" | "input"
>;

/** context.violations 한 page. 줄마다 이미 Context Engineer에게 넘겼는지(handed_off)를 가진다. */
export type ViolationsPage = Pick<
  z.infer<typeof contextViolationsReadSchema>,
  "violations" | "complete" | "next_cursor"
>;

export interface ContainingContext {
  readonly context: string;
  readonly title: string;
  readonly types: readonly string[];
}

export type SaveViewRequest = z.infer<typeof viewSaveRequestSchema>;
export type GlossarySetRequest = z.infer<typeof glossarySetRequestSchema>;
export type GlossaryRemoveRequest = z.infer<
  typeof glossaryRemoveRequestSchema
>;
export type HandOffRequest = z.infer<typeof violationsHandOffRequestSchema>;
export type HandOffResult = z.infer<typeof violationsHandOffResultSchema>;
export type RollbackRequest = {
  readonly context: string;
  readonly bundle: string;
};
/** 보관·보관 풀기. revision은 목록에서 읽은 context의 revision이다(그 사이 바뀌면 conflict). */
export type ArchiveRequest = {
  readonly context: string;
  readonly revision: string;
};
export type RollbackResult = z.infer<typeof bundleRollbackResultSchema>;

/** 이미 있는 항목을 고치거나 지울 때 보내는 비교 기준(항목을 읽은 때의 revision). */
export interface BaseRevision {
  readonly base_revision: string;
}

export interface ContextsSource {
  // ---------- 읽기 ----------
  /** 이 프로젝트의 보관되지 않은 context(drafting·active). 제목 순. */
  list(project: string): Promise<ReadResult<readonly ContextListItem[]>>;
  /** 이 프로젝트의 보관한 context. 제목 순. */
  archived(project: string): Promise<ReadResult<readonly ContextListItem[]>>;
  get(context: string): Promise<ReadResult<ContextDetail>>;
  overview(context: string): Promise<ReadResult<ContextOverview>>;
  /** 적용된 판의 계약 내용. 적용된 판이 없으면 content가 null이다. */
  contract(context: string): Promise<ReadResult<ContextContract>>;
  bundles(context: string): Promise<ReadResult<readonly BundleEntry[]>>;
  search(request: SearchRequest): Promise<ReadResult<SearchPage>>;
  /** 선언된 검색의 고르는 입력(entity·value)에 보일 후보. */
  inputOptions(
    request: InputOptionsRequest,
  ): Promise<ReadResult<InputOptions>>;
  violations(context: string): Promise<ReadResult<ViolationsPage>>;
  glossary(context: string): Promise<ReadResult<readonly GlossaryEntry[]>>;
  savedViews(
    context: string,
  ): Promise<ReadResult<readonly SavedViewListItem[]>>;
  /** 이 문서를 개체로 다루는 활성 context. */
  containing(
    project: string,
    path: string,
  ): Promise<ReadResult<readonly ContainingContext[]>>;

  // ---------- 사람이 보내는 명령 ----------
  saveView(request: SaveViewRequest): Promise<CommandResult<SavedViewValue>>;
  /** 새 항목이면 compare 없이, 기존 항목이면 base_revision과 함께. */
  glossarySet(
    request: GlossarySetRequest,
    compare?: BaseRevision,
  ): Promise<CommandResult<GlossaryEntry>>;
  glossaryRemove(
    request: GlossaryRemoveRequest,
    compare: BaseRevision,
  ): Promise<CommandResult<{ readonly entry: string }>>;
  /** violations를 빼면 전부를 넘긴다. */
  handOffViolations(
    request: HandOffRequest,
  ): Promise<CommandResult<HandOffResult>>;
  rollback(request: RollbackRequest): Promise<CommandResult<RollbackResult>>;
  archive(request: ArchiveRequest): Promise<CommandResult<ContextValue>>;
  unarchive(request: ArchiveRequest): Promise<CommandResult<ContextValue>>;
}
