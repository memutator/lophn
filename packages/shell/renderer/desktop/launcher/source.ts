// 런처가 읽고 쓰는 통로. documents#T7의 projects.list·create와 main의 OS 폴더 선택기만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.

/** 추적 규칙 한 줄. 등록 폴더 기준 glob이다. */
export interface TrackingRule {
  readonly effect: "include" | "exclude";
  readonly glob: string;
}

/** projects.list 결과의 한 프로젝트에서 런처가 쓰는 부분. */
export interface ProjectCard {
  readonly id: string;
  /** 안쪽 짧은 이름(slug). 펼친 상세에만 보인다. */
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly { readonly path: string }[];
  readonly tracking: {
    readonly enabled: boolean;
    readonly patterns: readonly TrackingRule[];
    readonly useGitignore: boolean;
  };
  readonly documentCount: number;
}

/** 등록 창에서 사람이 고른 폴더와 그 설명. */
export interface FolderDraft {
  readonly path: string;
  readonly description: string;
}

/** projects.create에 보낼 것. id와 짧은 이름은 통로가 아니라 model이 정한다. */
export interface ProjectDraft {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly FolderDraft[];
}

export type LauncherResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

export type FolderPick =
  | { ok: true; path: string | null }
  | { ok: false };

export interface LauncherSource {
  /** 보관하지 않은 프로젝트 전부. */
  projects(): Promise<LauncherResult<readonly ProjectCard[]>>;
  /** 등록만 한다. 추적은 꺼진 채로 만든다. */
  register(draft: ProjectDraft): Promise<LauncherResult<ProjectCard>>;
  /** OS 폴더 선택기. 사람이 그만두면 path가 null이다. */
  pickFolder(): Promise<FolderPick>;
}
