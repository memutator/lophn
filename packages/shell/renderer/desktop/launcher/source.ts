// 등록 dialog가 읽고 쓰는 통로. core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.

/** 등록 창에서 사람이 고른 폴더와 그 설명. */
export interface FolderDraft {
  readonly path: string;
  readonly description: string;
}

/** 등록에 보낼 것. 안쪽 짧은 이름은 통로가 정한다. */
export interface ProjectDraft {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly FolderDraft[];
}

type RegisterResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

export type FolderPick =
  | { ok: true; path: string | null }
  | { ok: false };

/** 등록 dialog가 쓰는 통로. ProjectsSource가 이 모양을 채운다. */
export interface RegisterSource {
  register(draft: ProjectDraft): Promise<RegisterResult<{ id: string }>>;
  /** OS 폴더 선택기. 사람이 그만두면 path가 null이다. */
  pickFolder(): Promise<FolderPick>;
}
