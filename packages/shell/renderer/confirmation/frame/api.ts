// 보호 창이 보는 API. confirmationDisplaySchema와 같다.
// displayId와 request, main이 독립 read로 만든 종류별 view만 알고 handle 원문은 없다.
export type ConfirmationRequest =
  | {
    kind: "approval_request";
    approval: string;
    created_seq: string;
    binding_hash: string;
  }
  | {
    kind: "question_option_action";
    group: string;
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

export type DisplayState =
  | "ready"
  | "stale"
  | "expired"
  | "unknown"
  | "submitted";

export interface ConfirmationView {
  displayId: string;
  request: ConfirmationRequest;
  /** main이 정본에서 만든 종류별 표시 값. 없으면 보호 틀만 그린다. */
  view?: Record<string, unknown>;
  state?: DisplayState;
  /** 지금 누를 수 있는 결정 이름. */
  decisions?: readonly string[];
  /** 결정 전에 영향과 범위를 다시 보이는 단계가 있다. */
  second?: boolean;
  /** 창이 다시 읽기 전에 보여주는 단계. IPC payload에는 없다. */
  step?: "second" | "stale";
}

export type ConfirmationResult =
  | "accepted"
  | "applying"
  | "applied"
  | "partial"
  | "uncertain"
  | "blocked";

/** confirmationOutcomeSchema 또는 main이 돌려준 오류. 값·handle은 없다. */
export type SubmitResult =
  | {
    outcome: "decided";
    receipt?: { kind: "entity"; id: string } | { kind: "event"; seq: string };
    result?: ConfirmationResult;
    secret_ref?: string;
    stored?: "stored" | "unchanged" | "revoked";
  }
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

export interface ConfirmationFrameApi {
  getDisplay(): Promise<ConfirmationView>;
  submit(input: {
    displayId: string;
    decision: string;
    /** 그 결정의 입력(거절 이유, secret 값). 결과로 돌아오지 않는다. */
    input?: Record<string, unknown>;
    confirmedSecond?: boolean;
  }): Promise<SubmitResult>;
  cancel(): Promise<{ outcome: "dismissed" }>;
  /** main이 표시를 다시 고정하면 새 표시를 받는다. */
  subscribe?(listener: (view: ConfirmationView) => void): () => void;
}

export function failedSubmit(
  result: SubmitResult,
): result is { ok: false; error: { code: string; message: string } } {
  return "ok" in result && result.ok === false;
}
