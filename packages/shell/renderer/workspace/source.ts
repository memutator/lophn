// 작업대가 읽는 통로. documents의 projects get·문서 목록 read 결과와
// layout 저장·복원만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { CallAgent } from "../../../protocol/lophn-agent/calls.ts";
import type { FileFailure } from "../../ipc/files.ts";
import type { AgentsSource } from "./agents/source.ts";
import type { FileSearchSource } from "./search/source.ts";
import type { RunRecordView } from "./sidebar/run-list.tsx";

/** 연결 폴더. 하위 폴더 경로는 이 폴더 기준 상대 경로다. */
export interface ProjectFolderView {
  readonly path: string;
  /** 디스크에서 찾을 수 있는가. false면 sidebar가 "찾을 수 없음"을 보인다. */
  readonly found: boolean;
  readonly subfolders: readonly { readonly path: string }[];
}

/** projects.get 결과에서 작업대가 쓰는 부분. */
export interface ProjectView {
  readonly id: string;
  readonly title: string;
  readonly folders: readonly ProjectFolderView[];
}

/** domain.list 결과에서 화면이 쓰는 부분. */
export interface DomainView {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly status: "active" | "archived";
}

/** domain을 담는 그릇. */
export interface DomainOwner {
  readonly kind: "project" | "app";
  readonly id: string;
}

/** 새 domain 입력. name은 slug이고 만든 뒤 바꿀 수 없다. */
export interface DomainDraft {
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
}

/** domain을 바꾸는 일의 결과. 실패는 core의 오류 code와 그 이유(화면이 그대로 보인다)다. */
export type DomainOpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** project 창과 앱 공간이 같이 쓰는 domain 쓰기. */
export interface DomainActions {
  createDomain(owner: DomainOwner, draft: DomainDraft): Promise<DomainOpResult>;
  /** 앱의 마지막 active domain이면 core가 `conflict`로 거절한다. */
  archiveDomain(domain: string): Promise<DomainOpResult>;
  unarchiveDomain(domain: string): Promise<DomainOpResult>;
}

/** 폴더 한 단계의 항목. 이름순이다. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: "file" | "folder";
}

/** 프로젝트 폴더에서 문서로 잡힌 파일. 경로는 등록 폴더 기준 상대 경로다. */
export interface FileRow {
  /** 이 파일이 속한 등록 폴더 경로. sidebar가 폴더 아래에 문서를 보일 때 쓴다. */
  readonly folder?: string;
  readonly path: string;
  readonly document: string;
  readonly title: string;
}

/** 파일 tree를 바꾸는 일의 결과. 실패는 main이 돌려준 code다. */
export type FileOpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: FileFailure };

/** `runs/list`의 거르기 칸. 같은 이름의 `ListRuns` 입력으로 간다. */
export interface RunFilter {
  readonly place?:
    | { readonly project: string }
    | { readonly app: string };
  readonly agent?: CallAgent;
}

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/** 저장된 layout 읽기. ipc/workspace의 LayoutReadResult와 같은 모양이다. */
export type LayoutRead =
  | { ok: true; available: true; layout: unknown }
  | { ok: true; available: false; reason: string }
  | { ok: false; message: string };

export interface WorkspaceSource extends DomainActions {
  project(id: string): Promise<ReadResult<ProjectView>>;
  /** 폴더 한 단계를 디스크에서 읽는다(절대 경로). Explorer가 폴더를 펼칠 때 그 폴더만 부른다. */
  list(path: string): Promise<ReadResult<readonly FolderEntry[]>>;
  /** 새 파일·폴더. 없는 위쪽 폴더도 만들고, 이미 있으면 `conflict`다(덮어쓰지 않는다). */
  create(path: string, kind: "file" | "folder"): Promise<FileOpResult>;
  /** 이름 바꾸기이자 옮기기. 대상이 있으면 `conflict`, 폴더를 자기 안으로 옮기면 `invalid_input`이다. */
  rename(from: string, to: string): Promise<FileOpResult>;
  /** OS 휴지통으로 보낸다. 휴지통을 못 쓰면 `unavailable`이고 지우지 않는다. */
  trash(path: string): Promise<FileOpResult>;
  /** OS 파일 관리자에서 보인다. */
  reveal(path: string): Promise<FileOpResult>;
  /**
   * Agents 탭과 sidebar의 Agents 묶음의 통로. 없으면 그 탭과 여는 길을 두지
   * 않는다. coreWorkspaceSource가 core 통로를 넣고 mock 모드는 fake를 넣는다.
   */
  readonly agentsSource?: AgentsSource;
  /** project 키워드 검색 통로. 없으면 Search 탭과 여는 길을 두지 않는다. */
  readonly searchSource?: FileSearchSource;
  /** run 기록, 새것이 앞. project sidebar와 앱 공간이 읽는다. */
  runs(filter: RunFilter): Promise<ReadResult<readonly RunRecordView[]>>;
  /** project가 가진 active domain들. */
  domains(project: string): Promise<ReadResult<readonly DomainView[]>>;
  /** 팔레트 파일 묶음. 문서로 잡힌 파일만 탭으로 열 수 있다. */
  files(project: string): Promise<ReadResult<readonly FileRow[]>>;
  readLayout(project: string): Promise<LayoutRead>;
  saveLayout(layout: unknown): Promise<{ ok: boolean }>;
}
