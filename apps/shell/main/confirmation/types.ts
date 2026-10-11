// shell tsc는 packages를 보지 않는다. confirmation이 contracts를 import하면
// packages/base까지 graph에 들어가므로, 통로에 필요한 모양만 여기 둔다.
// 값은 contracts/platform·contracts/shell과 같아야 한다.

/** base64url 32 bytes. contracts confirmationRefSchema와 같다. */
export type ConfirmationRef = string;

/** contracts shell confirmationIntentSchema의 approval preselect. 계속 허락(Always)은 없다. */
export type ApprovalPreselect = "allow_once" | "allow_session" | "deny";

/** contracts shell confirmationIntentSchema의 네 종류. */
export type ConfirmationIntent =
  | {
    kind: "approval_request";
    approval: string;
    /** 대화 안 카드가 미리 고른 결정. 창은 이 선택을 보이게 열 뿐 결정을 제출하지 않는다. */
    preselect?: ApprovalPreselect;
  }
  | {
    kind: "question_option_action";
    question: string;
    option_key: string;
  }
  | {
    kind: "owner_decision";
    concern: string;
    decision: string;
    /** 결정 대상의 고정 ID(예: 되돌릴 run). */
    targets?: string[];
    automation?: string;
    requirement?: number;
    /** 문제 결정에서 고른 결정. */
    choice?: "fixed" | "not_fixed" | "not_visible" | "dismiss";
    /** dismiss의 한 줄 이유. */
    note?: string;
  }
  | {
    kind: "secret_input";
    owner: string;
    purpose: string;
    /** provider credential의 값 아닌 등록 정보. */
    credential?: ProviderCredentialFields;
    /** 이미 등록한 계정 하나의 교체·삭제. */
    change?: { key: string; action: "replace" | "revoke" };
  };

/** contracts shell providerCredentialFieldsSchema. */
export interface ProviderCredentialFields {
  readonly key: string;
  readonly kind: "api_key" | "oauth";
  readonly label: string;
  readonly account: string | null;
  readonly organization: string | null;
  readonly plan: string | null;
  /** 없으면 main이 제출 때 넣은 값에서 만든다. */
  readonly dedup_fingerprint?: string;
}

/**
 * confirmationDisplaySchema의 request. 표시 IPC는 이 객체만 보낸다.
 * handle 원문·gate 내부 상태는 넣지 않는다.
 */
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
    targets: string[];
    input: { kind: "inline"; value: Record<string, unknown> } | {
      kind: "blob";
      sha256: string;
    };
    comparison: Record<string, unknown>;
  }
  | { kind: "secret_input"; owner: string; purpose: string };

/** command route 중 제출이 쓰는 조각. contracts Route 전체는 끌어오지 않는다. */
export interface CommandRouteRef {
  readonly kind: "command";
  readonly resource: string;
  readonly method: string;
}

/** main↔core 등록 메시지. contracts confirmationHandleRegisterSchema와 같다. */
export interface ConfirmationHandleRegister {
  readonly type: "confirmation_handle_register";
  readonly window_id: string;
  readonly target_ref: string;
  readonly content_hash: string;
  readonly allowed_decisions: readonly string[];
  readonly expires_at: string;
}

/** confirmationDisplaySchema. view는 종류별 표시 값이고 handle·gate 원문은 없다. */
export interface ConfirmationDisplay {
  readonly displayId: string;
  readonly request: ConfirmationRequest;
  readonly view?: Record<string, unknown>;
  readonly state?: "ready" | "stale" | "expired" | "unknown" | "submitted";
  readonly decisions?: readonly string[];
  readonly second?: boolean;
}

/** confirmationOutcomeSchema의 decided result. */
export type ConfirmationResult =
  | "accepted"
  | "applying"
  | "applied"
  | "partial"
  | "uncertain"
  | "blocked";
