// settings update 자리가 읽고 청하는 통로. 사람이 고른 로컬 package metadata 후보 선택 UI와
// 안내만 있다. 자동 다운로드·설치·재시작은 없다(platform/install-and-update#R13). 모양은
// platform#T50의 updateNotice·stopForUpdate 입구에서 이 자리가 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** 사람이 고른 로컬 update metadata. 파일을 읽은 결과다. */
export interface UpdatePackageView {
  readonly version: string;
  readonly os: "linux" | "darwin" | "windows";
  readonly format: string;
  readonly schema: number;
}

/** package metadata를 읽어 만든 안내. 이 OS가 아니면 mismatch다(다른 오류는 code다). */
export type UpdateNoticeResult =
  | {
    readonly state: "ready";
    readonly currentVersion: string;
    readonly newVersion: string;
    readonly os: string;
    readonly schema:
      | "compatible"
      | "migration_required"
      | "newer_than_package";
    readonly restartRequired: boolean;
  }
  | { readonly state: "failed"; readonly mismatch: true }
  | { readonly state: "failed"; readonly code: string };

export interface UpdateSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** 사람이 고른 로컬 update metadata 파일을 읽는다. 선택기는 OS가 연다. */
  choosePackage(): Promise<SourceResult<UpdatePackageView | null>>;
  /** 고른 metadata로 만든 안내. 이 OS가 아니면 mismatch다. */
  notice(candidate: UpdatePackageView): Promise<UpdateNoticeResult>;
  /** 정상 정지를 청한다(설치 파일 교체 전). 결과를 확인하지 못하면 실패다. */
  stopForUpdate(): Promise<SourceResult<boolean>>;
}
