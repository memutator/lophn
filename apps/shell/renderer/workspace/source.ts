// 작업대가 읽는 통로. documents#T7(projects get)·documents#T6(문서 목록)·
// documents/contexts(연관 컨텍스트)의 read 결과와 T13 layout 저장·복원만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.

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

/** contexts.related 결과의 한 컨텍스트. */
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
  contexts(project: string): Promise<ReadResult<readonly ContextRow[]>>;
  readLayout(project: string): Promise<LayoutRead>;
  saveLayout(layout: unknown): Promise<{ ok: boolean }>;
}
