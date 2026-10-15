// lophn 공간 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 contracts(search·outline·projects)에서
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

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly revision: string;
  readonly archived: boolean;
}

export interface ProjectChange {
  readonly name?: string;
  readonly title?: string;
  readonly purpose?: string;
}

export interface LophnSource {
  catalog(): Promise<SourceResult<Catalog>>;
  search(
    conditions: SearchConditions,
    cursor?: string,
  ): Promise<SourceResult<SearchPage>>;
  projects(): Promise<SourceResult<readonly ProjectRow[]>>;
  updateProject(
    project: ProjectRow,
    change: ProjectChange,
  ): Promise<SourceResult<ProjectRow>>;
  setProjectArchived(
    project: ProjectRow,
    archived: boolean,
  ): Promise<SourceResult<ProjectRow>>;
}
