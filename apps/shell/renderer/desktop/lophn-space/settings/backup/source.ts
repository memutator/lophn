// settings 백업 자리가 읽고 청하는 통로. 화면은 이 interface만 보고 core route 이름과
// 복원 pipe는 core-source.ts만 안다. 모양은 contracts(backups)와 ipc(restore)에서 이 자리가
// 쓰는 field만 옮긴 것이다. secret 값은 이 통로에 없고 보호 창만 연다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** backup 묶음 하나. 사람이 볼 만한 만들기·검증·보존 값만 옮긴 것이다. */
export interface BackupRow {
  /** 묶음의 만들어진 시각(ISO). restore·남은 묶음의 기준이다. */
  readonly createdAt: string;
  /** 이 묶음에 담긴 마지막 기록. */
  readonly throughSeq: string;
  /** 만들기(기록)가 끝났고 무결성 검사를 통과했는지. 통과해야 복원할 수 있다. */
  readonly restoreable: boolean;
  /** 무결성 검사 통과 묶음만 완전하다. */
  readonly integrity: "passed" | "failed";
  /** 묶음 안의 자료 크기(바이트). */
  readonly sizeBytes: number;
}

/** 복원 계획. 잃을 최신 기록 범위와 확인 기준이다(platform#T42). */
export interface RestorePlanView {
  readonly createdAt: string;
  readonly throughSeq: string;
  readonly currentThroughSeq: string;
  /** 복원하면 잃는 기록. 잃는 것이 없으면 null이다. */
  readonly lost: {
    readonly fromSeq: string;
    readonly throughSeq: string;
    readonly events: number;
  } | null;
}

export type RestoreOutcome =
  | "restored"
  | "failed"
  | "unconfirmed"
  | "restarted";

export interface BackupSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** 복원 가능한 묶음 목록(최근 것이 먼저). */
  backups(): Promise<SourceResult<readonly BackupRow[]>>;
  /**
   * 복원 계획을 읽는다. main이 core pipe로 읽어 온다(확인 창이 보일 값). 못 읽으면 실패다.
   */
  restorePlan(
    createdAt: string,
  ): Promise<SourceResult<RestorePlanView>>;
  /**
   * 사람이 확인한 복원을 제출한다. main이 결정 handle을 발급해 core pipe로 보낸다. 결과는
   * 성공·실패·core 재시작을 구별한다.
   */
  restoreSubmit(
    createdAt: string,
    plan: RestorePlanView,
  ): Promise<SourceResult<RestoreOutcome>>;
  /** secret 값의 암호 보호 export를 시작한다. 값은 보호 창만 받는다. */
  exportSecrets(): Promise<SourceResult<null>>;
  /** secret 값의 암호 보호 import를 시작한다. 값은 보호 창만 받는다. */
  importSecrets(): Promise<SourceResult<null>>;
  /** 앱 목록(사람이 지은 이름). 별도 앱 export의 대상이다. */
  apps(): Promise<SourceResult<readonly NamedRow[]>>;
  /**
   * 사람이 고른 앱의 자료를 밖으로 내보낸다(별도 앱 export, apps#T28에서 넘어온 것). 준비 결과
   * (ready·failed·preparing)만 답하고 실제 묶음은 core가 처리한다. 플랫폼 backup의 제외 자료가
   * 이 묶음에 자동 포함됐다고 설명하지 않는다.
   */
  exportApp(app: string): Promise<SourceResult<ExportRow>>;
}

/** 앱 하나(별도 export의 대상). */
export interface NamedRow {
  readonly id: string;
  readonly name: string;
}

/** 앱 export 준비 결과. */
export interface ExportRow {
  readonly app: string;
  readonly state: "preparing" | "ready" | "failed";
  readonly reason?: string;
  readonly includesExternalData: boolean;
}
