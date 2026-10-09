// settings 화면의 backup 복원 통로. renderer는 복원 계획(잃을 최신 기록 범위)과 결과만
// 받고 handle 원문·pipe frame은 이 파일과 main에만 있다(platform/backup-and-migration#R13,
// shell/wording#R12). 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** renderer가 main에 복원 계획을 묻는 요청. 대상은 묶음(`created_at`) 하나다. */
export const RESTORE_PLAN_CHANNEL = "shell:restore-plan";

/** renderer가 사람 확인 뒤 복원을 제출하는 요청. */
export const RESTORE_SUBMIT_CHANNEL = "shell:restore-submit";

/** 복원하면 잃는 기록 범위. 잃는 것이 없으면 lost가 null이다. */
export type RestoreLost =
  | {
    readonly from_seq: string;
    readonly through_seq: string;
    readonly events: number;
  }
  | null;

/** main이 core pipe에서 읽은 복원 계획. 창에 보이는 값만 있다. */
export type RestorePlanReply =
  | {
    readonly ok: true;
    readonly created_at: string;
    readonly through_seq: string;
    readonly current_through_seq: string;
    readonly lost: RestoreLost;
  }
  | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
  };

/** 복원 결과. 성공·실패·(실패라면) core가 다시 시작했는지를 구별한다. */
export type RestoreSubmitReply =
  | {
    readonly ok: true;
    readonly created_at: string;
    readonly restored_through_seq: string;
    readonly previous_through_seq: string | null;
    /** 복원 뒤 core가 다시 시작했다. 화면은 연결이 다시 준비될 때까지 기다린다. */
    readonly restarted: boolean;
  }
  | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
    readonly restarted: boolean;
  };

/** 복원 계획 요청 입력. 대상 묶음 하나다. */
export type RestorePlanInput = { readonly created_at: string };

/** 복원 제출 입력. 계획을 읽었던 같은 묶음이다. */
export type RestoreSubmitInput = { readonly created_at: string };
