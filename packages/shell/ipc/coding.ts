// Settings › Coding agents의 shell IPC 경계. renderer는 harness 감지 읽기와
// 다시 감지만 보내고 main이 따로 다시 검사한다. token·경로 설정·credential은 이 통로에 없다.
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
  /** 제품마다 감지 결과와 맡길 수 있는지를 읽는다. 처음에만 감지하고 이후는 마지막 결과다. */
  z.strictObject({ op: z.literal("harnesses") }),
  /** 사람이 [Detect again]을 누를 때만. 화면이 열릴 때·다시 들어올 때는 보내지 않는다. */
  z.strictObject({ op: z.literal("refresh") }),
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
  readonly auth:
    | "verified"
    | "not_verified"
    | "unknown"
    | "error"
    | "unverified_capability";
  readonly profile_id: string | null;
  readonly observed_at: string;
  readonly freshness: "fresh" | "stale";
  readonly executable: string | null;
  readonly candidates: readonly { path: string; source: string }[];
  readonly probes: readonly { probe: string; outcome: string }[];
}

/** Settings가 제품마다 보이는 값. `reason`은 맡길 수 없거나 메시지를 못 넣는 까닭이고 없으면 null이다. */
export interface HarnessSettingsView {
  readonly harness_id: HarnessName;
  readonly label: string;
  readonly discovery: HarnessDiscovery;
  readonly version: string | null;
  readonly version_result: "verified" | "unknown" | "error";
  readonly login: HarnessView["auth"];
  readonly can_launch: boolean;
  readonly can_deliver_messages: boolean;
  readonly reason: string | null;
  /** 감지한 때. 감지 결과를 읽지 못했으면 없다. */
  readonly observed_at?: string;
  /** 찾은 실행 파일 경로. 못 찾았으면 없거나 null이다. */
  readonly executable?: string | null;
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
  /** 사람이 지은 project 이름. */
  readonly project_name: string;
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
    readonly error: {
      readonly code: CodingFailureCode;
      readonly message: string;
    };
  };

/** preload가 desktop 창 본문에 여는 통로. */
export interface CodingApi {
  harnesses(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
  refresh(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
}
