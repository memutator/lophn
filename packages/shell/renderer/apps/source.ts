// apps 화면과 앱 공간이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 protocol(apps.list·get·runtime·archive·unarchive)에서 이
// 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../source-result.ts";

export type { SourceResult };

/** 등록한 앱 하나. 이름은 사람이 지은 그대로다. */
export interface AppRow {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  /** 지금 쓰는 version. 아직 없으면 null이다. */
  readonly release: string | null;
  /** 그 version의 번호(`r7`의 7). 번호를 읽지 못했거나 version이 없으면 null이다. */
  readonly releaseNumber: number | null;
  /** 보관·꺼내기의 비교 기준. */
  readonly revision: string;
}

/** 새 앱. description은 한 줄이다. */
export interface AppDraft {
  readonly name: string;
  readonly description: string;
}

/** 앱이 주인인 공개 package 하나와 그것을 켜진 release로 쓰는 다른 앱 수. */
export interface PublishedPackage {
  readonly name: string;
  readonly users: number;
}

/** supervisor가 본 실행 상태. 과거 기록으로 running이라 하지 않는다. */
export type RunState = "preparing" | "stopped" | "running" | "unavailable";

export interface AppsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** 보관한 앱까지 모두. */
  list(): Promise<SourceResult<readonly AppRow[]>>;
  /** 없는 앱·범위 밖 앱은 null이다. */
  get(app: string): Promise<SourceResult<AppRow | null>>;
  runtime(app: string): Promise<SourceResult<RunState>>;
  /** 앱을 등록한다. slug가 다른 앱과 겹치면 `conflict`다. */
  create(draft: AppDraft): Promise<SourceResult<AppRow>>;
  /** 보관하면 실행도 끈다. 꺼내도 사람이 허용하기 전에는 시작하지 않는다. */
  setArchived(app: AppRow, archived: boolean): Promise<SourceResult<AppRow>>;
  /** 보관한 앱을 영구히 지운다. 보관하지 않은 앱은 `conflict`, 앱 process가 아직 멈추는 중이면 `unavailable`이다. */
  deleteApp(app: AppRow): Promise<SourceResult<null>>;
  /** 앱이 주인인 공개 package. 지워도 남고 주인이 빈다. 지우기 전에 사람에게 보인다. */
  publishedPackages(
    app: AppRow,
  ): Promise<SourceResult<readonly PublishedPackage[]>>;
  /** 그 version에서 앱 공간에 여는 화면. 선언에 full 크기로 적힌 첫 화면이다. */
  entryScreen(app: string, release: string): Promise<SourceResult<string>>;
}
