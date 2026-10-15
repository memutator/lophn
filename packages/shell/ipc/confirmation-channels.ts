// 보호 창 IPC 이름. 보호 preload는 schema 없이 이 이름만 묶는다.
export const CONFIRMATION_OPEN_CHANNEL = "shell:confirmation-open";
// 창 없는 사람 결정 handle을 청하는 통로. 일반 preload가 갖는다.
export const DECISION_HANDLE_CHANNEL = "shell:decision-handle";
export const CONFIRMATION_DISPLAY_CHANNEL = "confirmation:display";
export const CONFIRMATION_SUBMIT_CHANNEL = "confirmation:submit";
export const CONFIRMATION_CANCEL_CHANNEL = "confirmation:cancel";
// 확인을 연 창에게만 가는 끝남 알림. 확정되지 않고 끝난 종류만 알리고 내용은 싣지 않는다.
export const CONFIRMATION_ENDED_CHANNEL = "shell:confirmation-ended";
export const CONFIRMATION_ENDED_KINDS = [
  "cancelled",
  "closed",
  "crashed",
  "expired",
  "replaced",
  "rejected",
] as const;

export type ConfirmationEndedKind = (typeof CONFIRMATION_ENDED_KINDS)[number];

export interface ConfirmationEnded {
  readonly windowId: string;
  readonly ended: ConfirmationEndedKind;
}
