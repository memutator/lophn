// settings update 통로. renderer는 사람이 고른 로컬 metadata 경로와 그 안내 후보만 보내고,
// 읽기와 이 OS 대조는 main이 한다. 적용은 그 파일로 정상 정지 뒤 설치 파일만 바꾼다.
// 다운로드·재시작 채널은 없다.

/** 사람이 고른 로컬 update metadata 파일. */
export const UPDATE_READ_CHANNEL = "shell:update-read";

/** 고른 metadata로 만든 안내. 이 OS가 아니면 mismatch다. */
export const UPDATE_NOTICE_CHANNEL = "shell:update-notice";

/** 정상 정지 뒤 설치 파일 교체. 경로는 마지막으로 읽은 파일만 쓴다. */
export const UPDATE_APPLY_CHANNEL = "shell:update-apply";

export type UpdatePackageView = {
  version: string;
  os: "linux" | "darwin" | "windows";
  format: string;
  schema: number;
};

export type UpdateReadReply =
  | { ok: true; value: UpdatePackageView }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

export type UpdateNoticeValue =
  | {
    state: "ready";
    currentVersion: string;
    newVersion: string;
    os: string;
    schema: "compatible" | "migration_required" | "newer_than_package";
    restartRequired: boolean;
  }
  | { state: "failed"; mismatch: true };

export type UpdateNoticeReply =
  | { ok: true; value: UpdateNoticeValue }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

/** 설치 파일을 바꿨으면 true. 정지를 확인하지 못하면 파일을 바꾸지 않는다. */
export type UpdateApplyReply =
  | { ok: true; value: true }
  | { ok: false; code: "forbidden" | "unavailable" };
