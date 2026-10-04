// 보호 창이 보는 API. confirmationDisplaySchema와 같다.
// displayId와 request만 알고 handle 원문·gate는 없다.
export type ConfirmationRequest =
  | {
    kind: "approval_request";
    approval: string;
    created_seq: string;
    binding_hash: string;
  }
  | {
    kind: "question_option_action";
    question: string;
    option_key: string;
    created_seq: string;
    binding_hash: string;
  }
  | {
    kind: "owner_decision";
    concern: string;
    decision: string;
    targets: readonly string[];
    input: { kind: "inline"; value: Record<string, unknown> } | {
      kind: "blob";
      sha256: string;
    };
    comparison: Record<string, unknown>;
  }
  | { kind: "secret_input"; owner: string; purpose: string };

export interface ConfirmationView {
  displayId: string;
  request: ConfirmationRequest;
  /** 창이 다시 읽기 전에 보여주는 단계. IPC payload에는 없다. */
  step?: "second" | "stale";
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
