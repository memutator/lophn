// coding agent 연결과 [Start]의 shell IPC 경계(shell#T50, shell/desktop#R19). renderer는 고정 intent와
// 사람이 고른 값만 보내고 main이 따로 다시 검사한다. token·경로 설정·credential은 이 통로에 없다.
// 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고 import가 없다.
import { z } from "zod";

export const CODING_CHANNEL = "shell:coding";

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** "이 harness로 연결" 고정 intent의 이름. 이 말고 연결을 만드는 통로는 renderer에 없다. */
export const CONNECT_INTENT = "connect_with_harness";

export const HARNESS_IDS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "hermes",
  "pi",
  "openclaw",
] as const;

export type HarnessName = typeof HARNESS_IDS[number];

export const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all"), app: z.null() }),
  z.strictObject({ kind: z.literal("app"), app: z.string().regex(APP_ID) }),
]);

export type ConnectionScope = z.infer<typeof scopeSchema>;

/** 사람이 연결 화면에서 고른 것: 감지된 harness 하나, 연결 이름, 범위. 설치 target은 main이 만든다. */
export const connectRequestSchema = z.strictObject({
  intent: z.literal(CONNECT_INTENT),
  harness_id: z.enum(HARNESS_IDS),
  label: z.string().min(1).max(80).regex(/\S/),
  scope: scopeSchema,
});

export type ConnectRequest = z.infer<typeof connectRequestSchema>;

/** renderer가 부를 수 있는 호출. 이름이 없으면 main이 거절한다. */
export const codingCallSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("detect") }),
  /** 사람이 [Detect again]을 누를 때만. 화면이 열릴 때·다시 들어올 때는 보내지 않는다. */
  z.strictObject({ op: z.literal("refresh") }),
  z.strictObject({ op: z.literal("connect"), request: z.unknown() }),
  z.strictObject({ op: z.literal("folders") }),
  /** 사람이 [Start]를 누른 값. main이 한 번 더 검사한다. */
  z.strictObject({ op: z.literal("start"), click: z.unknown() }),
  z.strictObject({ op: z.literal("sessions") }),
]);

export type CodingCallInput = z.infer<typeof codingCallSchema>;

export type HarnessDiscovery =
  | "unobserved"
  | "detected"
  | "absent"
  | "unknown"
  | "error";

/** 감지한 harness 하나. 경로·probe는 펼친 자리에만 보인다. */
export interface HarnessView {
  readonly harness_id: HarnessName;
  readonly discovery: HarnessDiscovery;
  readonly version: string | null;
  readonly version_result: "verified" | "unknown" | "error";
  readonly auth: "verified" | "not_verified" | "unknown" | "error" | "unverified_capability";
  readonly profile_id: string | null;
  readonly observed_at: string;
  readonly freshness: "fresh" | "stale";
  readonly executable: string | null;
  readonly candidates: readonly { path: string; source: string }[];
  readonly probes: readonly { probe: string; outcome: string }[];
}

export interface DetectView {
  /** 저장한 결과(cached)인지, 처음 감지(first)인지, 사람 요청 재감지(refreshed)인지. */
  readonly source: "cached" | "first" | "refreshed";
  readonly harnesses: readonly HarnessView[];
}

export type InstallStatus = "complete" | "partial" | "failed" | "error";

export interface ConnectView {
  readonly connection: string;
  readonly install: {
    readonly status: InstallStatus;
    /** 설치 resource 하나의 위치와 결과. 펼친 자리에만 보인다. */
    readonly resources: readonly {
      identity: string;
      outcome: string;
    }[];
  };
  /** doctor가 확인한 loading 단계. 확인하지 못했으면 null이다. */
  readonly checks:
    | readonly {
      stage: string;
      result: "success" | "failure" | "unknown";
    }[]
    | null;
}

export interface FolderChoiceView {
  readonly project: string;
  readonly folder_ref: string;
  readonly path: string;
}

export type TuiState =
  | "starting"
  | "ready"
  | "working"
  | "waiting_input"
  | "ended"
  | "unknown";

export type PromptDelivery =
  | "none"
  | "pending"
  | "delivered"
  | "not_delivered"
  | "unknown";

/** lophn이 [Start]로 연 TUI 하나. TUI 상태는 Task 상태와 다른 사실이다. */
export interface SessionView {
  readonly runtime_ref: string;
  readonly ticket: string;
  readonly connection: string;
  readonly tui: TuiState;
  readonly prompt_delivery: PromptDelivery;
}

export type StartView =
  | { readonly ok: true; readonly runtime_ref: string }
  | {
    readonly ok: false;
    readonly reason: string;
    readonly next: readonly string[];
    /** 자기 터미널 안내가 있으면 true. 안내 원문은 이 통로로 나가지 않는다. */
    readonly own_terminal: boolean;
  };

export type CodingFailureCode =
  | "invalid_input"
  | "forbidden"
  | "unavailable"
  | "conflict"
  | "not_detected";

export type CodingReply<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    readonly error: { readonly code: CodingFailureCode; readonly message: string };
  };

/** preload가 desktop 창 본문에 여는 통로. */
export interface CodingApi {
  detect(): Promise<CodingReply<DetectView>>;
  refresh(): Promise<CodingReply<DetectView>>;
  connect(request: ConnectRequest): Promise<CodingReply<ConnectView>>;
  folders(): Promise<CodingReply<readonly FolderChoiceView[]>>;
  start(click: unknown): Promise<CodingReply<StartView>>;
  sessions(): Promise<CodingReply<readonly SessionView[]>>;
}
