// apps 화면과 앱 공간이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 protocol(apps.list·get·archive·unarchive)에서 이
// 화면이 쓰는 field만 옮긴 것이다.
import type { CleanUpMode } from "../../../protocol/base/follow-ups.ts";
import type { AppViewOpen } from "../../ipc/app-frame.ts";
import type { SourceResult } from "../source-result.ts";
import type { AvailableApp, TakeInOutcome } from "./take-in.ts";

export type { AvailableApp, SourceResult, TakeInOutcome };

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

/** 앱 view로 여는 화면 하나와 그 자리. */
export interface OpenScreen {
  readonly key: string;
  readonly place: AppViewOpen["place"];
}

export interface AppsSource {
  /** 다른 컴퓨터가 내놓았고 이 컴퓨터에 아직 없는 앱(`machine/environment`의 `available`). */
  available(): Promise<SourceResult<readonly AvailableApp[]>>;
  /** 그 앱을 이 컴퓨터에 들여 release를 준비한다. 앱이 `available`에 없으면 `sync_off`다. 켜는 것은 따로다. */
  takeIn(app: string): Promise<TakeInOutcome>;
  /** 보관한 앱까지 모두. */
  list(): Promise<SourceResult<readonly AppRow[]>>;
  /** 없는 앱·범위 밖 앱은 null이다. */
  get(app: string): Promise<SourceResult<AppRow | null>>;
  /** 앱을 등록한다. slug가 다른 앱과 겹치면 `conflict`다. */
  create(draft: AppDraft): Promise<SourceResult<AppRow>>;
  /** 보관하면 실행도 끈다. 꺼내도 사람이 허용하기 전에는 시작하지 않는다. */
  setArchived(app: AppRow, archived: boolean): Promise<SourceResult<AppRow>>;
  /** 보관한 앱을 영구히 지운다. 보관하지 않은 앱은 `conflict`, 앱 process가 아직 멈추는 중이면 `unavailable`이다. */
  deleteApp(
    app: AppRow,
    cleanUp?: CleanUpMode,
  ): Promise<SourceResult<{ readonly handoff_session: string | null } | null>>;
  /** 앱이 주인인 공개 package. 지워도 남고 주인이 빈다. 지우기 전에 사람에게 보인다. */
  publishedPackages(
    app: AppRow,
  ): Promise<SourceResult<readonly PublishedPackage[]>>;
  /**
   * 그 version에서 여는 화면. screen이 없으면 선언에 `tab` 자리로 적힌 첫 화면이다. 있으면 그 화면이고 자리는 그 `places`에서
   * `phone`, `tab`, 첫 자리 순으로 고른다. 선언에 없으면 `not_found`(영구)이고, 선언을 읽지 못한 것은 그 읽기의 오류 code다.
   */
  screenToOpen(
    app: string,
    release: string,
    screen?: string,
  ): Promise<SourceResult<OpenScreen>>;
}
