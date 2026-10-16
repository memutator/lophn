// 앱 프로세스 실패의 근거를 구별해 problems에 보낸다. 예상 밖 종료, 기동 실패와
// ready timeout, crash loop, V8 OOM은 서로 다른 근거 이름으로 남고 의도된 정지는
// 보내지 않는다. 전송은 problems의 process_exit 관측(/v1/problems/observe-exception)이고
// 어느 앱·release인지는 본문이 아니라 인증된 process observer 결속이 정한다.
import type { IdSource } from "../../../../base/mod.ts";
import {
  exceptionObservationInputSchema,
  type ObservedExceptionInput,
} from "../../../../protocol/problems/mod.ts";

const CRASH_EVIDENCE = [
  "unexpected_exit",
  "start_failed",
  "ready_timeout",
  "crash_loop",
  "v8_oom",
] as const;
type CrashEvidence = (typeof CRASH_EVIDENCE)[number];

export type CrashEvent =
  | {
    kind: "exit";
    // 정지 요청 전에 의도된 종료로 표시한 종료다.
    intended: boolean;
    // 신호로 죽었으면 null이다.
    exitCode: number | null;
    // 자식 stderr의 마지막 부분. V8 OOM 근거를 찾는 데만 쓰고 보고에 싣지 않는다.
    stderrTail: string;
  }
  | { kind: "start_failed"; reason: { code: string; summary: string } }
  | { kind: "crash_loop"; exits: number };

type CrashDeps = {
  ids: IdSource;
  now: () => number;
  // 문제 보고 전송. 조립이 observe-exception으로 연결한다.
  report: (input: ObservedExceptionInput) => Promise<void> | void;
};

type CrashOutcome = {
  evidence: CrashEvidence;
  input: ObservedExceptionInput;
  // 전송이 실패해도 관측 자체는 남는다. 실패한 전송을 성공으로 말하지 않는다.
  reported: boolean;
};

// V8이 힙을 못 늘리고 죽을 때 stderr에 찍는 고정 문구다.
const V8_OOM =
  /(Reached heap limit|JavaScript heap out of memory|FatalProcessOutOfMemory)/;

function classifyExit(
  event: Extract<CrashEvent, { kind: "exit" }>,
): CrashEvidence | undefined {
  if (event.intended) return undefined;
  // 정상 종료 code 0도 상주 앱에는 예상 밖이다. 의도 표시가 없으면 센다.
  return V8_OOM.test(event.stderrTail) ? "v8_oom" : "unexpected_exit";
}

function evidenceOf(event: CrashEvent): CrashEvidence | undefined {
  if (event.kind === "exit") return classifyExit(event);
  if (event.kind === "crash_loop") return "crash_loop";
  return event.reason.summary === "ready timeout"
    ? "ready_timeout"
    : "start_failed";
}

function messageOf(event: CrashEvent, evidence: CrashEvidence): string {
  if (event.kind === "crash_loop") {
    return `automatic restart stopped after ${event.exits} unexpected exits`;
  }
  if (event.kind === "start_failed") return event.reason.summary;
  if (evidence === "v8_oom") return "the app process ran out of V8 heap";
  return event.exitCode === null
    ? "the app process was terminated by a signal"
    : `the app process exited with code ${event.exitCode}`;
}

type CrashObserver = {
  // 의도된 정지면 undefined다.
  observe(event: CrashEvent): Promise<CrashOutcome | undefined>;
};

export function createCrashObserver(deps: CrashDeps): CrashObserver {
  return {
    async observe(event) {
      const evidence = evidenceOf(event);
      if (evidence === undefined) return undefined;
      const input: ObservedExceptionInput = {
        report_id: deps.ids.newId("rpt"),
        observed_at: new Date(deps.now()).toISOString(),
        observation: "process_exit",
        error: {
          name: evidence,
          message: messageOf(event, evidence),
          message_missing_reason: null,
          stack: null,
          stack_missing_reason: {
            reason: "process exit has no JavaScript stack",
          },
        },
        error_missing_reason: null,
        invocation: null,
      };
      // 우리가 만든 값이 contract에 맞는지 보낸 뒤가 아니라 보내기 전에 확인한다.
      const checked = exceptionObservationInputSchema.parse(input);
      let reported = true;
      try {
        await deps.report(checked);
      } catch {
        // 전송 실패가 원래 crash를 숨기지 않는다. 결과에 reported=false로 남긴다.
        reported = false;
      }
      return { evidence, input: checked, reported };
    },
  };
}
