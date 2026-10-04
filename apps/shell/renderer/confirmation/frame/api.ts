// 보호 창이 보는 API. displayId만 알고 handle 원문은 없다.
export interface ConfirmationGate {
  state: "checking" | "ready" | "stale" | "expired" | "submitted" | "unknown";
  decisions?: readonly string[];
  second?: boolean;
  reason?: string;
}

export interface ConfirmationView {
  displayId: string;
  gate: ConfirmationGate;
  display: {
    titleKey: string;
    bodyKey: string;
  } | null;
}

export interface ConfirmationFrameApi {
  getDisplay(): Promise<ConfirmationView>;
  submit(input: {
    displayId: string;
    decision: string;
    confirmedSecond?: boolean;
  }): Promise<
    { ok: true } | { ok: false; error: { code: string; message: string } }
  >;
  cancel(): Promise<{ outcome: "dismissed" }>;
}
