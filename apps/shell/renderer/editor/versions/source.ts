// 버전 이력·비교·복원이 읽는 통로(shell/editor#R6, R13, R14). documents#T16(section 이력·
// diff·restore), documents#T6(문서·판)의 결과에서 화면이 쓰는 것만 담는다. core를 직접
// 부르지 않고 화면이 주입한 통로만 쓴다. 복원은 main의 편집 통로가 준비·파일 쓰기와 함께 한다.
import type { RestoreReport } from "../../../ipc/editor.ts";
import type { SourceResult } from "../source.ts";

/** 판을 저장한 주체의 종류. 화면은 이 종류만 사람 말로 바꾼다. */
export type SaverKind =
  | "user"
  | "agent"
  | "coding_agent"
  | "app"
  | "machine"
  | "other";

/** 이력의 판 하나. */
export interface VersionRow {
  readonly id: string;
  readonly number: number;
  readonly savedBy: SaverKind;
  /** 저장 시각(ms). */
  readonly savedAt: number;
  /** 제품이 이 판에 남긴 run. agent 저장이 아니면 null이다. */
  readonly run: string | null;
  /** 파일 관측으로 생긴 판인지. */
  readonly fromFile: boolean;
  readonly contentHash: string;
  /** 경로별 원문 행이 있어 그 바이트로 되살릴 수 있는지. */
  readonly restorable: boolean;
}

/** 정보 탭이 보이는 문서 사실. */
export interface DocumentFacts {
  readonly id: string;
  readonly title: string;
  /** 문서 안 대표 파일의 상대 경로. 파일 묶음이 아니면 null이다. */
  readonly primaryPath: string | null;
  /** 원본 파일과 이어진 문서인지(project 파일·지침 파일). */
  readonly linked: boolean;
  readonly archived: boolean;
  readonly formatName: string;
  readonly formatExplicit: boolean;
  readonly latestVersion: string;
  readonly latestNumber: number;
  readonly savedAt: number;
  readonly savedBy: SaverKind;
}

/** 줄 범위(1부터, 끝 포함). */
export interface LineSpan {
  readonly start: number;
  readonly end: number;
}

/** diff의 한 변경 묶음. text는 그 줄들을 "\n"으로 이은 것이다. */
export interface ChangeRun {
  readonly range: LineSpan;
  readonly text: string;
}

/** 비교하지 못한 구간. 변경 없음으로 채우지 않는다. */
export interface Omission {
  readonly version: string;
  readonly ranges: readonly LineSpan[];
  readonly reason: string;
}

/** documents.diff를 끝까지 이어 읽은 결과. */
export interface VersionDiff {
  readonly additions: readonly ChangeRun[];
  readonly deletions: readonly ChangeRun[];
  readonly omissions: readonly Omission[];
  /** page 상한까지 읽고도 끝나지 않았으면 false다. */
  readonly complete: boolean;
}

/** outline.document의 절 하나. 절 비교(body_hash)와 줄 위치를 함께 쓴다. */
export interface SectionEntry {
  readonly key: string;
  readonly title: string;
  readonly level: number;
  readonly ownRanges: readonly LineSpan[];
  readonly subtree: LineSpan;
  readonly bodyHash: string;
}

export type SectionChange = "unchanged" | "modified" | "added" | "missing";

/** documents.section_history의 한 행. */
export interface SectionHistoryRow {
  readonly version: string;
  readonly status: SectionChange;
}

export interface SectionHistory {
  readonly rows: readonly SectionHistoryRow[];
  /** 본문을 확인하지 못해 비교에서 빠진 판. */
  readonly omitted: readonly string[];
}

/** 이 문서를 담은 컨텍스트. */
export interface DocumentContext {
  readonly id: string;
  readonly title: string;
}

export interface VersionSource {
  facts(document: string): Promise<SourceResult<DocumentFacts>>;
  /** 판 목록. 새 판이 앞이다. */
  history(document: string): Promise<SourceResult<readonly VersionRow[]>>;
  /** 고정 판의 본문(대표 텍스트). diff 줄 번호와 같은 좌표다. */
  text(document: string, version: string): Promise<SourceResult<string>>;
  sections(
    document: string,
    version: string,
  ): Promise<SourceResult<readonly SectionEntry[]>>;
  diff(
    document: string,
    before: string,
    after: string,
  ): Promise<SourceResult<VersionDiff>>;
  sectionHistory(
    document: string,
    section: string,
  ): Promise<SourceResult<SectionHistory>>;
  contexts(document: string): Promise<SourceResult<readonly DocumentContext[]>>;
  /**
   * 고른 판을 새 최신 판으로 되살린다. base는 사람이 비교로 본 최신 판이다. 그 사이 최신 판이나
   * 원본 파일이 바뀌었으면 쓰지 않고 충돌을 돌려준다. 결과를 그대로 돌려준다.
   */
  restore(
    document: string,
    version: string,
    base: string,
  ): Promise<SourceResult<RestoreReport>>;
}
