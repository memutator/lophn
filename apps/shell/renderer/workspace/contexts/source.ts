// context 화면들이 읽고 보내는 통로(shell/workspace#R16~R29). 값의 모양은 documents/contexts의
// context API 계약(context-api.ts, context-contract.ts)이 정하고, 이 파일은 type만 가져온다
// (`import type`은 번들에 들어가지 않는다). core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
// 읽기와 명령은 workspace/source.ts의 ReadResult로 성공·실패 이유를 돌려준다.
import type { z } from "zod";
import type {
  BundleContent,
  DeclaredSearch,
} from "../../../../../packages/contracts/documents/context-contract.ts";
import type {
  bundleRollbackResultSchema,
  BundleSummary,
  CheckReport,
  contextGetReadSchema,
  contextListItemSchema,
  contextOverviewReadSchema,
  contextSearchRequestSchema,
  ContextValue,
  GlossaryEntry,
  glossaryRemoveRequestSchema,
  glossarySetRequestSchema,
  savedViewListItemSchema,
  SavedViewValue,
  SearchRow,
  StoredViolation,
  viewSaveRequestSchema,
  ViolationKey,
  violationsHandOffRequestSchema,
  violationsHandOffResultSchema,
} from "../../../../../packages/contracts/documents/context-api.ts";
import type { searchInputValuesSchema } from "../../../../../packages/contracts/documents/context-contract.ts";
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
  SearchRow,
  StoredViolation,
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

/** 판 이력의 한 줄: 판과 그 검사 보고. 번호 내림차순, 번호 없는 draft가 맨 앞이다. */
export interface BundleEntry {
  readonly bundle: BundleSummary;
  readonly check: CheckReport | null;
}

export type SearchRequest = z.infer<typeof contextSearchRequestSchema>;

/**
 * contexts.search의 한 page. cursor로 다음 page를 읽는다. `total`은 계약의 읽기 결과에 없는
 * 값이다: 화면이 "1–25 of 61"과 page 번호를 그리려고 source가 채운다(모르면 null).
 */
export interface SearchPage {
  readonly rows: readonly SearchRow[];
  readonly complete: boolean;
  readonly next_cursor: string | null;
  readonly total: number | null;
}

/** 입력 form의 combobox가 보이는 후보 하나. 후보에 없는 값은 고를 수 없다. */
export interface PickOption {
  readonly value: string;
  readonly label: string;
}

export interface InputOptionsRequest {
  readonly context: string;
  readonly search: string;
  /** DeclaredSearch.inputs[].name */
  readonly input: string;
}

/** contexts.violations 한 page와, 이미 Context Engineer에게 넘긴 위반의 키. */
export interface ViolationsView {
  readonly violations: readonly StoredViolation[];
  readonly handed_off: readonly ViolationKey[];
  readonly complete: boolean;
  readonly next_cursor: string | null;
}

export interface ContainingContext {
  readonly context: string;
  readonly title: string;
  readonly types: readonly string[];
}

/** 만드는 중(drafting) context의 진행. 단계는 1~4(읽기·초안·검사·적용). */
export interface DraftProgress {
  readonly step: 1 | 2 | 3 | 4;
  /** 읽은 자리와 문서 수. 아직 읽지 않았으면 null. */
  readonly read: {
    readonly places: number;
    readonly documents: number;
  } | null;
  /** 흐린 초안 개체와 그 사이 관계. */
  readonly types: readonly string[];
  readonly relations: readonly {
    readonly from: string;
    readonly label: string;
    readonly to: string;
  }[];
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
export type RollbackResult = z.infer<typeof bundleRollbackResultSchema>;

/** 이미 있는 항목을 고치거나 지울 때 보내는 비교 기준(항목을 읽은 때의 revision). */
export interface BaseRevision {
  readonly base_revision: string;
}

export interface ContextsSource {
  // ---------- 읽기 ----------
  /** 이 프로젝트의 보관되지 않은 context(drafting·active). 제목 순. */
  list(project: string): Promise<ReadResult<readonly ContextListItem[]>>;
  get(context: string): Promise<ReadResult<ContextDetail>>;
  overview(context: string): Promise<ReadResult<ContextOverview>>;
  /** 적용된 판의 계약 내용(BundleContent). 적용된 판이 없으면 null. */
  contract(context: string): Promise<ReadResult<BundleContent | null>>;
  /** drafting context의 진행. 만드는 중이 아니면 null. */
  draft(context: string): Promise<ReadResult<DraftProgress | null>>;
  bundles(context: string): Promise<ReadResult<readonly BundleEntry[]>>;
  search(request: SearchRequest): Promise<ReadResult<SearchPage>>;
  /** 선언된 검색의 고르는 입력(entity·value)에 보일 후보. */
  inputOptions(
    request: InputOptionsRequest,
  ): Promise<ReadResult<readonly PickOption[]>>;
  violations(context: string): Promise<ReadResult<ViolationsView>>;
  glossary(context: string): Promise<ReadResult<readonly GlossaryEntry[]>>;
  savedViews(
    context: string,
  ): Promise<ReadResult<readonly SavedViewListItem[]>>;
  /** 이 문서를 개체로 다루는 활성 context. */
  containing(
    project: string,
    path: string,
  ): Promise<ReadResult<readonly ContainingContext[]>>;
  /** 이 context를 쓰는 Operator 수. */
  operatorCount(context: string): Promise<ReadResult<number>>;

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
}
