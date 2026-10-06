// projects 화면과 문서 정리가 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 contracts(projects, documents, history, export, files)에서 이
// 화면이 쓰는 field만 옮긴 것이다.
import type { PlaceRef, SourceResult } from "../source.ts";

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly revision: string;
  readonly archived: boolean;
  readonly documentCount: number;
  readonly tracking: boolean;
  /** 등록 폴더의 절대 경로. */
  readonly folders: readonly string[];
}

export interface ProjectChange {
  readonly name?: string;
  readonly title?: string;
  readonly purpose?: string;
}

/** 자리 안 문서 목록의 한 행. */
export interface PlacedDocument {
  readonly id: string;
  readonly title: string;
  readonly name: string | null;
  readonly latestVersion: string;
  readonly archived: boolean;
}

/** 정리할 문서 하나. 지금 revision·원본 파일·최신 판 파일 수까지 읽는다. */
export interface DocumentDetail {
  readonly id: string;
  readonly title: string;
  readonly name: string | null;
  readonly place: PlaceRef | null;
  readonly revision: string;
  readonly latestVersion: string;
  readonly archived: boolean;
  /** 연결된 프로젝트 파일. 지침 파일·연결 없음은 null이다. */
  readonly file: { readonly project: string; readonly path: string } | null;
  /** 최신 판의 유일한 파일 경로. 파일이 여럿이면 null이다. */
  readonly singleFile: string | null;
}

export interface VersionRow {
  readonly id: string;
  readonly number: number;
}

export type ExportFormat = "markdown" | "json";

export interface ExportFile {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
}

/** export가 실제로 묶은 문서 하나. files가 null이면 원래 파일을 돌려줄 수 없는 판이다. */
export interface ExportedDocument {
  readonly document: string;
  readonly title: string;
  readonly version: string;
  readonly number: number;
  readonly files: readonly ExportFile[] | null;
}

export interface ExportResult {
  readonly format: ExportFormat;
  readonly documents: readonly ExportedDocument[];
}

/** 파일 작업 뒤 연결 단계 하나. documents FileStep과 같은 뜻이다. */
export type FileStep =
  | { readonly state: "done" }
  | { readonly state: "skipped"; readonly reason: string }
  | { readonly state: "failed"; readonly code: string }
  | { readonly state: "not_attempted" };

/** 파일로 두기 결과. 파일 쓰기와 연결 단계(원본 연결, 추적 규칙, 자리)는 따로다. */
export interface PlaceOutcome {
  readonly file: "written" | "conflict" | "failed" | "unknown";
  readonly path: string | null;
  readonly steps: {
    readonly source: FileStep;
    readonly tracking: FileStep;
    readonly move: FileStep;
  } | null;
}

/** 파일에서 빼기 결과. 파일 삭제와 연결 단계(원본 연결 해제, 자리 되돌리기)는 따로다. */
export interface UnlinkOutcome {
  readonly file: "deleted" | "gone";
  readonly steps: { readonly source: FileStep; readonly move: FileStep };
}

/**
 * 빼기 요청의 답. 지우기는 사람의 결정이라 보호 창을 연다(review). 그 창의 결정 결과를
 * 받는 통로가 있으면 done으로 단계 결과를 돌려준다.
 */
export type RemoveReply =
  | { readonly kind: "review" }
  | { readonly kind: "done"; readonly outcome: UnlinkOutcome };

export interface OrganizeSource {
  projects(): Promise<SourceResult<readonly ProjectRow[]>>;
  updateProject(
    project: ProjectRow,
    change: ProjectChange,
  ): Promise<SourceResult<ProjectRow>>;
  setProjectArchived(
    project: ProjectRow,
    archived: boolean,
  ): Promise<SourceResult<ProjectRow>>;
  placeDocuments(
    place: PlaceRef,
  ): Promise<SourceResult<readonly PlacedDocument[]>>;
  document(id: string): Promise<SourceResult<DocumentDetail>>;
  renameDocument(
    document: DocumentDetail,
    name: string,
  ): Promise<SourceResult<DocumentDetail>>;
  moveDocument(
    document: DocumentDetail,
    place: PlaceRef | null,
    name: string | null,
  ): Promise<SourceResult<DocumentDetail>>;
  versions(document: string): Promise<SourceResult<readonly VersionRow[]>>;
  exportDocuments(
    place: PlaceRef,
    picks: readonly { readonly document: string; readonly version: string }[],
    format: ExportFormat,
  ): Promise<SourceResult<ExportResult>>;
  placeFile(
    document: DocumentDetail,
    project: string,
    path: string,
  ): Promise<SourceResult<PlaceOutcome>>;
  removeFile(document: DocumentDetail): Promise<SourceResult<RemoveReply>>;
}
