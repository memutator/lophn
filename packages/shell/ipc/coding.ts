// Settings › Coding agents의 shell IPC 경계. renderer는 harness 감지 읽기와
// 다시 감지만 보내고 main이 따로 다시 검사한다. token·경로 설정·credential은 이 통로에 없다.
// 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고 import가 없다.
import { z } from "zod";

export const CODING_CHANNEL = "shell:coding";

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

/** renderer가 부를 수 있는 호출. 이름이 없으면 main이 거절한다. */
export const codingCallSchema = z.discriminatedUnion("op", [
  /** 제품마다 감지 결과와 맡길 수 있는지를 읽는다. 처음에만 감지하고 이후는 마지막 결과다. */
  z.strictObject({ op: z.literal("harnesses") }),
  /** 사람이 [Detect again]을 누를 때만. 화면이 열릴 때·다시 들어올 때는 보내지 않는다. */
  z.strictObject({ op: z.literal("refresh") }),
]);

export type HarnessDiscovery =
  | "unobserved"
  | "detected"
  | "absent"
  | "unknown"
  | "error";

/** 로그인 확인 결과. */
export type HarnessLogin =
  | "verified"
  | "not_verified"
  | "unknown"
  | "error"
  | "unverified_capability";

/** Settings가 제품마다 보이는 값. `reason`은 맡길 수 없거나 메시지를 못 넣는 까닭이고 없으면 null이다. */
export interface HarnessSettingsView {
  readonly harness_id: HarnessName;
  readonly label: string;
  readonly discovery: HarnessDiscovery;
  readonly version: string | null;
  readonly version_result: "verified" | "unknown" | "error";
  readonly login: HarnessLogin;
  readonly can_launch: boolean;
  readonly can_deliver_messages: boolean;
  readonly reason: string | null;
  /** 감지한 때. 감지 결과를 읽지 못했으면 없다. */
  readonly observed_at?: string;
  /** 찾은 실행 파일 경로. 못 찾았으면 없거나 null이다. */
  readonly executable?: string | null;
}

type CodingFailureCode =
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
