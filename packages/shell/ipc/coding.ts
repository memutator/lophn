// Settings › Coding agents의 shell IPC 경계. renderer는 harness 감지 읽기와
// 다시 감지만 보내고 main이 따로 다시 검사한다. token·경로 설정·credential은 이 통로에 없다.
// 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고 import가 없다.
import { z } from "zod";

export const CODING_CHANNEL = "shell:coding";
/** main이 창에 push하는 전역 hook 설치 확인 요청. 창은 `hook_answer`로 답한다. */
export const CODING_HOOK_ASK_CHANNEL = "shell:coding-hook-ask";
/** main이 창에 push하는 전역 hook 설치 결과. 답은 없다. */
export const CODING_HOOK_RESULT_CHANNEL = "shell:coding-hook-result";

export const HARNESS_IDS = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "omp",
  "cursor",
  "copilot",
  "kimi",
  "kiro",
  "antigravity",
  "grok",
  "droid",
  "amp",
  "devin",
  "qwen",
  "qoder",
  "hermes",
  "muse",
  "codebuddy",
  "command-code",
  "prime-agent",
  "mimocode",
  "cline",
  "letta",
  "kilo",
] as const;

export type HarnessName = typeof HARNESS_IDS[number];

/** renderer가 부를 수 있는 호출. 이름이 없으면 main이 거절한다. */
export const codingCallSchema = z.discriminatedUnion("op", [
  /** 제품마다 감지 결과와 맡길 수 있는지를 읽는다. 처음에만 감지하고 이후는 마지막 결과다. */
  z.strictObject({ op: z.literal("harnesses") }),
  /** 사람이 [Detect again]을 누를 때만. 화면이 열릴 때·다시 들어올 때는 보내지 않는다. */
  z.strictObject({ op: z.literal("refresh") }),
  /** 제품마다 전역 hook이 놓였는지 본다(dry_run이라 아무것도 쓰지 않는다). */
  z.strictObject({ op: z.literal("hook_status") }),
  /** 사람이 Settings에서 [Install hooks]를 누를 때만. 누른 것이 허락이라 다시 묻지 않는다. */
  z.strictObject({
    op: z.literal("install_hooks"),
    harness: z.enum(HARNESS_IDS),
  }),
  /** 사람이 hook 설치 확인 dialog에서 고른 답. request는 main이 push한 것이다. */
  z.strictObject({
    op: z.literal("hook_answer"),
    request: z.string().min(1).max(80),
    accepted: z.boolean(),
  }),
]);

/** 어느 coding agent에 전역 hook을 놓아도 되는지 묻는다. files는 놓을 file의 절대 경로다. */
export interface HookAsk {
  readonly request: string;
  readonly harness: string;
  readonly label: string;
  readonly files: readonly string[];
}

/** 사람이 허락한 설치의 끝. 실패하면 message가 까닭이고 files는 알면 문제의 file이다. */
export interface HookResult {
  readonly harness: string;
  readonly label: string;
  readonly ok: boolean;
  readonly files: readonly string[];
  readonly message?: string;
  /**
   * 사람 터미널에서 이미 도는 harness를 알아보고 놓았다. harness는 hook을 시작할 때 읽어서(Hermes는
   * `_prepare_agent_startup`에서 한 번) 그 실행에는 상태가 보이지 않는다.
   */
  readonly running: boolean;
}

/**
 * 전역 hook 상태. `unsupported`는 hook이 없는 제품이거나 이 실행에서 hook command를 못 정한 것이고,
 * `failed`는 설정 file을 읽거나 쓰지 못한 것이다.
 */
export type HookInstallStatus =
  | "installed"
  | "missing"
  | "unsupported"
  | "failed";

export interface HarnessHookView {
  readonly harness_id: HarnessName;
  readonly status: HookInstallStatus;
  /** missing이면 놓을 file, installed를 막 놓았으면 쓴 file의 절대 경로다. */
  readonly files: readonly string[];
}

export type HarnessDiscovery =
  | "unobserved"
  | "detected"
  | "absent"
  | "unknown"
  | "error";

/** Settings가 제품마다 보이는 값. `reason`은 맡길 수 없거나 메시지를 못 넣는 까닭이고 없으면 null이다. */
export interface HarnessSettingsView {
  readonly harness_id: HarnessName;
  readonly label: string;
  readonly discovery: HarnessDiscovery;
  readonly version: string | null;
  readonly version_result: "verified" | "unknown" | "error";
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
  hookStatus(): Promise<CodingReply<readonly HarnessHookView[]>>;
  installHooks(harness: HarnessName): Promise<CodingReply<HarnessHookView>>;
  /** main이 보낸 hook 설치 확인에 답한다. */
  answerHookAsk(
    input: { request: string; accepted: boolean },
  ): Promise<CodingReply<null>>;
  /** main이 hook 설치를 물을 때마다 부른다. 구독 해지를 돌려준다. */
  onHookAsk(listener: (ask: HookAsk) => void): () => void;
  /** main이 hook 설치 결과를 알릴 때마다 부른다. 구독 해지를 돌려준다. */
  onHookResult(listener: (result: HookResult) => void): () => void;
}
