// lophn 공간 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 contracts(search·series·outline·documents)에서
// 이 화면이 쓰는 field만 옮긴 것이다(contracts를 들이면 zod가 renderer bundle에 들어간다).

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

export type PlaceKind = "project" | "app";

export interface PlaceRef {
  readonly kind: PlaceKind;
  readonly id: string;
}

export interface Named {
  readonly id: string;
  readonly title: string;
}

/** 전체 목차에서 고르는 자리. 조건 선택지로만 쓴다. */
export interface Catalog {
  readonly projects: readonly Named[];
  readonly apps: readonly Named[];
}

export interface SearchConditions {
  readonly query: string;
  readonly place: PlaceRef | null;
  readonly format: string | null;
  /** 보관 문서도 제목으로 찾는다. 검색 index는 보관 문서를 넣지 않는다. */
  readonly includeArchived: boolean;
}

/** 검색이 반영한 범위. 지연·재생성·누락만 화면이 판단에 쓴다. */
export interface Coverage {
  readonly lagging: boolean;
  readonly rebuilding: boolean;
  readonly omissions: number;
}

export interface SearchHit {
  readonly document: string;
  readonly version: string;
  readonly latestVersion: string;
  readonly section: string | null;
  readonly title: string;
  readonly snippet: string;
  readonly format: string;
  /** 원문이 아닌 요약·주제에서 맞았는지. */
  readonly fromSummary: boolean;
}

export interface SearchPage {
  readonly hits: readonly SearchHit[];
  readonly coverage: Coverage;
  readonly nextCursor: string | null;
}

/** 보관된 문서 중 제목이 맞는 것. 고정 판을 그대로 연다. */
export interface ArchivedHit {
  readonly document: string;
  readonly version: string;
  readonly title: string;
  readonly format: string;
}

export interface OutlineSection {
  readonly key: string;
  readonly title: string;
  readonly level: number;
}

export type SectionStatus =
  | "whole"
  | "found"
  | "missing"
  | "unverified"
  | "unsupported";

export interface DocumentOutline {
  readonly document: string;
  readonly version: string;
  readonly latestVersion: string;
  readonly status: SectionStatus;
  readonly sections: readonly OutlineSection[];
}

export interface DocumentHead {
  readonly title: string;
  readonly versionNumber: number;
  readonly savedAt: number;
  readonly status: "active" | "archived";
}

export interface ReadPage {
  readonly status: SectionStatus;
  readonly text: string | null;
  /** 가려져 글이 오지 않았다. */
  readonly hidden: boolean;
  readonly complete: boolean;
  readonly nextCursor: string | null;
}

/** 링크(자리/문서#section@판)를 지금 문서로 푼 결과. */
export interface Resolved {
  readonly document: string;
  readonly version: string;
  readonly section: string | null;
  /** 이름이나 자리가 바뀐 옛 참조였다. */
  readonly moved: boolean;
  /** 지금 쓰는 링크. 자리 없는 문서는 null이다. */
  readonly current: string | null;
  /** 링크에 판을 적었다. */
  readonly pinned: boolean;
  readonly status: SectionStatus;
}

export type SeriesOrder =
  | { readonly kind: "key"; readonly direction: "ascending" | "descending" }
  | {
    readonly kind: "format_field";
    readonly field: string;
    readonly direction: "ascending" | "descending";
  };

/** 가족이 보존하는 작성 중 값. 첫 판 전에는 문서가 아니다. */
export interface SeriesDraft {
  /** 첫 판을 저장하면 이 id의 문서가 생기고 멤버가 된다. */
  readonly document: string;
  readonly key: string;
}

export interface Series {
  readonly id: string;
  readonly place: PlaceRef;
  readonly name: string;
  readonly title: string;
  readonly format: string;
  readonly order: SeriesOrder;
  readonly nextRule: string;
  readonly revision: string;
  readonly archived: boolean;
  /** 가족당 하나의 작성 중 값. 없으면 null이다. */
  readonly draft: SeriesDraft | null;
}

export interface SeriesRow extends Series {
  readonly members: number;
}

export interface SeriesMember {
  readonly key: string;
  readonly document: string;
  readonly title: string;
  readonly version: string;
  readonly latestVersion: string;
  readonly archived: boolean;
}

export interface SeriesDetail {
  readonly series: Series;
  readonly members: readonly SeriesMember[];
}

/** 다음 key 제안. 저장하지 않고 문서를 만들지 않는다. */
export interface NextSuggestion {
  /** 빈 가족이나 읽을 수 없는 key면 "". */
  readonly key: string;
  /** 계산 근거 key. */
  readonly from: string | null;
  /** 이미 쓴 key나 이름이다. */
  readonly taken: boolean;
}

export interface SeriesDraftInput {
  readonly place: PlaceRef;
  readonly name: string;
  readonly title: string;
  readonly format: string;
  readonly direction: "ascending" | "descending";
  readonly nextRule: string;
}

export interface PlaceDocument {
  readonly id: string;
  readonly title: string;
  readonly format: string;
}

export interface LophnSource {
  catalog(): Promise<SourceResult<Catalog>>;
  formats(): Promise<SourceResult<readonly string[]>>;
  search(
    conditions: SearchConditions,
    cursor?: string,
  ): Promise<SourceResult<SearchPage>>;
  archived(
    conditions: SearchConditions,
  ): Promise<SourceResult<readonly ArchivedHit[]>>;
  head(document: string, version: string): Promise<SourceResult<DocumentHead>>;
  outline(
    document: string,
    version: string | null,
  ): Promise<SourceResult<DocumentOutline>>;
  read(
    document: string,
    version: string,
    section: string | null,
    cursor?: string,
  ): Promise<SourceResult<ReadPage>>;
  resolve(link: string): Promise<SourceResult<Resolved | null>>;
  seriesList(
    status: "active" | "all",
  ): Promise<SourceResult<readonly SeriesRow[]>>;
  series(id: string): Promise<SourceResult<SeriesDetail>>;
  nextKey(id: string): Promise<SourceResult<NextSuggestion>>;
  createSeries(input: SeriesDraftInput): Promise<SourceResult<Series>>;
  addMember(
    series: Series,
    document: string,
    key: string,
  ): Promise<SourceResult<Series>>;
  setArchived(series: Series, archived: boolean): Promise<SourceResult<Series>>;
  /**
   * 이 key로 새 멤버를 쓰기 시작한다. 예정 문서 id와 key·가족 format을 가족 draft에 둔다. 글은
   * 아직 싣지 않는다(첫 판 저장이 같은 transaction에서 멤버로 넣고 draft를 비운다).
   */
  startDraft(series: Series, key: string): Promise<SourceResult<Series>>;
  /** 작성 중 값을 버린다. 문서는 없으므로 지울 문서도 없다. */
  clearDraft(series: Series): Promise<SourceResult<Series>>;
  /** 문서의 지금 최신 판. 아직 없으면 null이다. */
  latestVersion(document: string): Promise<SourceResult<string | null>>;
  placeDocuments(
    place: PlaceRef,
  ): Promise<SourceResult<readonly PlaceDocument[]>>;
}
