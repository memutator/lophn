// 앱 프로세스 실패의 근거를 구별해 앱 log 한 줄로 만든다. 예상 밖 종료, 기동 실패와
// ready timeout, crash loop, V8 OOM은 서로 다른 근거 이름으로 남고 의도된 정지는
// 쓰지 않는다. 어느 앱인지는 쓰는 쪽(조립)이 안다.
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
      // 자식 stderr의 마지막 부분. V8 OOM 근거를 찾는 데만 쓰고 줄에 싣지 않는다.
      stderrTail: string;
    }
  | { kind: "start_failed"; reason: { code: string; summary: string } }
  | { kind: "crash_loop"; exits: number };

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

// 앱 log에 쓸 한 줄이다. 의도된 정지면 undefined다.
export function crashLogText(event: CrashEvent): string | undefined {
  const evidence = evidenceOf(event);
  if (evidence === undefined) return undefined;
  return `process_exit ${evidence}: ${messageOf(event, evidence)}`;
}
