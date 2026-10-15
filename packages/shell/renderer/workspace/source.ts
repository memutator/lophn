// 작업대가 읽는 통로. documents의 projects get·문서 목록·
// documents/contexts(활성 context 목록)의 read 결과와 layout 저장·복원만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { AgentsSource } from "./agents/source.ts";
import type { ContextsSource } from "./contexts/source.ts";

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

/** 폴더 한 단계의 항목. 이름순이다. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: "file" | "folder";
}

/** documents.list 결과의 한 문서. 제목만 보인다. */
export interface DocumentRow {
  readonly id: string;
  readonly title: string;
}

/** 프로젝트 폴더에서 문서로 잡힌 파일. 경로는 등록 폴더 기준 상대 경로다. */
export interface FileRow {
  /** 이 파일이 속한 등록 폴더 경로. sidebar가 폴더 아래에 문서를 보일 때 쓴다. */
  readonly folder?: string;
  readonly path: string;
  readonly document: string;
  readonly title: string;
}

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/** 저장된 layout 읽기. ipc/workspace의 LayoutReadResult와 같은 모양이다. */
export type LayoutRead =
  | { ok: true; available: true; layout: unknown }
  | { ok: true; available: false; reason: string }
  | { ok: false; message: string };

export interface WorkspaceSource {
  project(id: string): Promise<ReadResult<ProjectView>>;
  /** 폴더 한 단계를 디스크에서 읽는다(절대 경로). Explorer가 폴더를 펼칠 때 그 폴더만 부른다. */
  list(path: string): Promise<ReadResult<readonly FolderEntry[]>>;
  documents(project: string): Promise<ReadResult<readonly DocumentRow[]>>;
  /**
   * Contexts·Context·Search 탭의 통로. 없으면 그 탭과 여는 길을 두지
   * 않는다. coreWorkspaceSource가 core 통로를 넣고 mock 모드는 fake를 넣는다.
   */
  readonly contextsSource?: ContextsSource;
  /**
   * Agents 탭과 sidebar의 Agents 묶음의 통로. 없으면 그 탭과 여는 길을 두지
   * 않는다. coreWorkspaceSource가 core 통로를 넣고 mock 모드는 fake를 넣는다.
   */
  readonly agentsSource?: AgentsSource;
  /** 팔레트 파일 묶음. 문서로 잡힌 파일만 탭으로 열 수 있다. */
  files(project: string): Promise<ReadResult<readonly FileRow[]>>;
  readLayout(project: string): Promise<LayoutRead>;
  saveLayout(layout: unknown): Promise<{ ok: boolean }>;
}
