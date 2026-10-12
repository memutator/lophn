// 추적 켜기가 읽고 쓰는 통로. documents#T7의 projects.get·list, documents#T10의
// preview_tracking·set_tracking만 담는다. core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.

export interface TrackingRule {
  readonly effect: "include" | "exclude";
  readonly glob: string;
}

export interface RuleSet {
  readonly enabled: boolean;
  readonly patterns: readonly TrackingRule[];
  readonly useGitignore: boolean;
}

/** projects.get 결과에서 추적 켜기가 쓰는 부분. */
export interface TrackingProject {
  readonly id: string;
  readonly title: string;
  readonly revision: string;
  readonly folders: readonly {
    readonly path: string;
    readonly description: string;
  }[];
  readonly tracking: RuleSet;
  /** 처음 켤 때의 기본 제안(documents/projects#R3). */
  readonly proposal: RuleSet;
}

export interface PreviewEntry {
  readonly folder: string;
  readonly path: string;
  readonly included: boolean;
  /** documents가 정한 이유. 화면은 model이 사람 말로 옮긴다. */
  readonly reason: string;
}

/** 끝까지 모은 미리보기. 적용은 미리 본 바로 그 구성을 보낸다(documents/projects#R6). */
export interface Preview {
  readonly baseRevision: string;
  readonly rules: RuleSet;
  readonly entries: readonly PreviewEntry[];
  /** set_tracking에 그대로 돌려줄 마지막 page. 화면은 열어 보지 않는다. */
  readonly basis: unknown;
}

/** 다른 프로젝트에서 추적이 켜진 폴더. 겹침 검사에 쓴다(documents/projects#R7). */
export interface TrackedRoot {
  readonly project: string;
  readonly title: string;
  readonly path: string;
}

export type TrackingResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

export interface TrackingSource {
  project(id: string): Promise<TrackingResult<TrackingProject>>;
  /** 활성 프로젝트 중 추적이 켜진 폴더. 이 프로젝트 것은 뺀다. */
  trackedRoots(except: string): Promise<TrackingResult<readonly TrackedRoot[]>>;
  preview(
    project: TrackingProject,
    rules: RuleSet,
  ): Promise<TrackingResult<Preview>>;
  apply(
    project: TrackingProject,
    preview: Preview,
  ): Promise<TrackingResult<TrackingProject>>;
}
