// 등록 dialog가 읽고 쓰는 통로. core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { ProjectItem } from "./projects/source.ts";

/** 등록 창에서 사람이 고른 폴더와 그 설명. */
export interface FolderDraft {
  readonly path: string;
  readonly description: string;
}

/** 등록에 보낼 것. id와 안쪽 짧은 이름은 core가 정한다. */
export interface ProjectDraft {
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly FolderDraft[];
  /** 등록 뒤 첫 폴더의 저장소에 기계를 넘는 id file을 만든다. */
  readonly shareIdentity: boolean;
}

/** 폴더를 읽은 값의 file 상태. project route의 `file` 칸이다. */
export type IdentityFile =
  | "none"
  | "committed"
  | "uncommitted"
  | "ignored"
  | "conflict"
  | "missing"
  | "unreadable";

/** 등록 전 폴더를 읽은 값(`project.match`). 이 기계의 같은 저장소와 폴더를 잃은 project 제안이 따라온다. */
export interface FolderMatch {
  readonly repo: "git" | "none" | null;
  readonly file: IdentityFile;
  /** 이 기계에 같은 id로 이미 등록된 project. */
  readonly same: ProjectItem | null;
  /** 같은 remote인 project. */
  readonly suggestions: readonly ProjectItem[];
}

type RegisterResult<T> = { ok: true; value: T } | { ok: false; code: string };

export type FolderPick = { ok: true; path: string | null } | { ok: false };

/** 등록 dialog가 쓰는 통로. ProjectsSource가 이 모양을 채운다. */
export interface RegisterSource {
  /** identityFailed: 등록은 됐지만 id file을 만들지 못했다. 상세의 줄이 [Set up]으로 보인다. */
  register(
    draft: ProjectDraft,
  ): Promise<RegisterResult<{ id: string; identityFailed?: boolean }>>;
  /** 고른 폴더를 읽는다. 실패하면 등록 dialog는 줄을 그리지 않는다. */
  match(path: string): Promise<RegisterResult<FolderMatch>>;
  /** 폴더를 잃은 project의 그 폴더를 path로 다시 잇는다. */
  relinkFolder(
    project: ProjectItem,
    folder: string,
    path: string,
  ): Promise<RegisterResult<{ id: string }>>;
  /** OS 폴더 선택기. 사람이 그만두면 path가 null이다. */
  pickFolder(): Promise<FolderPick>;
}
