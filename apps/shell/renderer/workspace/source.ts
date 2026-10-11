// 작업대가 읽는 통로. documents#T7(projects get)·documents#T6(문서 목록)·
// documents/contexts(활성 context 목록)의 read 결과와 T13 layout 저장·복원만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { ContextsSource } from "./contexts/source.ts";

/** projects.get 결과에서 작업대가 쓰는 부분. 폴더 경로만 sidebar에 보인다. */
export interface ProjectView {
  readonly id: string;
  readonly title: string;
  readonly folders: readonly { readonly path: string }[];
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

/** context.list 결과의 한 활성 context. */
export interface ContextRow {
  readonly id: string;
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
  documents(project: string): Promise<ReadResult<readonly DocumentRow[]>>;
  /** 프로젝트의 활성 context(context.list). 작업대 화면은 contextsSource를 쓰고 이 읽기는 더 부르지 않는다. */
  contexts(project: string): Promise<ReadResult<readonly ContextRow[]>>;
  /**
   * Contexts·Context·Search 탭의 통로(shell/workspace#R14~R31). 없으면 그 탭과 여는 길을 두지
   * 않는다. core 통로는 아직 없고 mock 모드가 fake를 넣는다.
   */
  readonly contextsSource?: ContextsSource;
  /** 팔레트 파일 묶음. 문서로 잡힌 파일만 탭으로 열 수 있다. */
  files(project: string): Promise<ReadResult<readonly FileRow[]>>;
  readLayout(project: string): Promise<LayoutRead>;
  saveLayout(layout: unknown): Promise<{ ok: boolean }>;
}
