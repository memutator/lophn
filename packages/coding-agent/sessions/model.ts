// sessions의 순수 값이다(coding-agent/sessions). IO가 없고 시각·파일·감지는 인자로 받는다
// (architecture). 시작 방식, 제품별 첫 prompt 전달 adapter, TUI 환경 값을 정의한다.
import type { HarnessId } from "../../protocol/coding-agent/mod.ts";

// 시작은 ticket·harness·방식 하나다. 방식은 사람이 자기 터미널에서 직접 시작하는 안내와 lophn의 project
// 터미널 탭 TUI 둘뿐이다. headless·자동 시작은 방식으로 받지 않는다.
export const TERMINAL_TUI = "terminal_tui" as const;

// 제품 TUI가 첫 prompt를 받는 검증한 방법이다(조사 T6). argv 방식은 harness가 스스로 submit하므로
// lophn이 PTY에 입력을 더 쓰지 않는다. stdin_after_ready는 검증한 composer readiness evidence가 있는
// adapter만 가진다. 검증하지 못한 제품은 시작하지 않고 자기 터미널 안내로 끝난다.
export type PromptAdapter = {
  harness_id: HarnessId;
  verified: boolean;
  // verified가 아니면 사람에게 보이는 이유다.
  unverified_reason: string | null;
  prompt:
    | {
      kind: "argv";
      // prompt 앞에 붙는 flag다. 없으면 positional 인자다.
      flag: string | null;
    }
    | {
      kind: "stdin_after_ready";
      // adapter가 검증한 composer readiness 신호다. 없으면 stdin 자동 주입을 허용하지 않는다.
      readiness: string | null;
    };
};

function verifiedArgv(
  harness: HarnessId,
  flag: string | null,
): PromptAdapter {
  return {
    harness_id: harness,
    verified: true,
    unverified_reason: null,
    prompt: { kind: "argv", flag },
  };
}

export const PROMPT_ADAPTERS: readonly PromptAdapter[] = [
  verifiedArgv("claude", null),
  verifiedArgv("codex", null),
  verifiedArgv("opencode", "--prompt"),
  verifiedArgv("gemini", "--prompt-interactive"),
  verifiedArgv("pi", null),
  {
    harness_id: "hermes",
    verified: false,
    unverified_reason:
      "Hermes의 TUI query 전달은 검증한 version manifest가 없어 시작하지 않는다",
    prompt: { kind: "argv", flag: null },
  },
  {
    harness_id: "openclaw",
    verified: false,
    unverified_reason:
      "OpenClaw의 TUI 준비 신호와 stdin 입력은 검증한 adapter가 없어 시작하지 않는다",
    prompt: { kind: "stdin_after_ready", readiness: null },
  },
];

// TUI process env의 overlay다. TERM 같은 안전 값만 있고 provider auth나 token은 없다. `LOPHN_CONNECTION`
// 참조는 plan이 연결마다 더하고 `LOPHN_TERMINAL_OBSERVE`는 host가 자기 socket 경로로 더한다.
export const ENV_SAFE_OVERLAY: Readonly<Record<string, string>> = {
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
};

// 상속된 다른 terminal·connection 식별 값이다. host는 overlay 뒤에 한 번 더 지운다.
export const ENV_DELETE: readonly string[] = [
  "LOPHN_TERMINAL_OBSERVE",
  "LOPHN_TOKEN",
  "LOPHN_CREDENTIAL",
  "LOPHN_APP_BROKER_CREDENTIAL",
];

// Windows의 `.cmd`·`.bat` shim은 줄바꿈 prompt를 argv로 넘기지 못한다(조사 T6).
export function isBatchShim(executable: string): boolean {
  return /\.(cmd|bat)$/i.test(executable);
}
