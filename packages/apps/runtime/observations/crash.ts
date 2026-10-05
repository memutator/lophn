// 예상 밖 종료·ready timeout·crash loop·V8 OOM의 근거를 구별해 문제 보고로
// 보낸다(R28). 의도된 정지는 보내지 않는다. 문제 보고는
// /v1/problems/observe-exception의 process_exit 관측이다(problems#T3).
import {
  exceptionObservationInputSchema,
  type ObservedExceptionInput,
} from "../../../contracts/problems/mod.ts";

export type CrashObservation =
  | "ready_timeout"
  | "crash_loop"
  | "v8_oom"
  | "unexpected_exit";

export type CrashSource = {
  observation: CrashObservation;
  app: string;
  release: string;
  observed_at: string;
  // 근거 요약. 상세 이유는 problems가 남긴다.
  summary: string;
  // 예상 밖 종료의 OS 종료 code. 신호 종료는 음수다.
  exitCode?: number | null;
};

export type CrashDeps = {
  now: () => number;
  // 문제 보고 전송. 조립이 /v1/problems/observe-exception으로 연결한다.
  report: (input: ObservedExceptionInput) => Promise<void> | void;
};

export type CrashObserver = {
  // 예상된 정지는 보내지 않는다(R28). intended면 undefined다.
  observe(source: CrashSource): ObservedExceptionInput | undefined;
};

// V8 OOM 종료의 실제 근거다. 다른 종료와 구별한다(R28).
export const V8_OOM_MESSAGE = "V8 out of memory";

// 의도된 정지 여부. supervisor가 예상한 정지는 crash로 세지 않는다(R18, R28).
function intended(summary: string): boolean {
  return (
    summary === "intended stop" || summary === "planned shutdown" ||
    summary === "user requested stop"
  );
}

function reportId(): string {
  // rpt ID는 받는 문제 보고의 ID 관례다. 관측 시각 기반 random suffix다.
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  return `rpt${Date.now().toString(36)}${random}`;
}

export function createCrashObserver(deps: CrashDeps): CrashObserver {
  return {
    observe(source) {
      // 의도된 정지는 보내지 않는다(R28).
      if (intended(source.summary)) return undefined;
      const input: ObservedExceptionInput = {
        report_id: reportId(),
        observed_at: source.observed_at,
        // 프로세스 종료 출처의 보고 필요 없는 stack은 없음으로 남긴다.
        observation: "process_exit",
        error: {
          name: source.observation,
          message: source.summary,
          message_missing_reason: null,
          stack: null,
          stack_missing_reason: { reason: "process exit has no JS stack" },
        },
        error_missing_reason: null,
        invocation: null,
      };
      const parsed = exceptionObservationInputSchema.safeParse(input);
      if (!parsed.success) {
        // bounded 재시도 없이 버린다. 보고 실패는 crash를 숨기지 않는다(R22).
        return undefined;
      }
      void Promise.resolve(deps.report(parsed.data)).catch(() => {
        // 전송 실패가 관측 자체를 잃지 않게 throw하지 않는다(R22).
      });
      return input;
    },
  };
}
