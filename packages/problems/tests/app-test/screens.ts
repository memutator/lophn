// 화면 검사(problems/tests#R7, problem-codes#R8, reporting#R5 view 쪽). shell의 앱 화면 검사
// host가 돌려준 관측을 runner가 그 요청의 mode=test·scope로 보고 접수에 넘기고, 접수된 것만
// harness의 ViewDriver 보고로 돌려준다. 접수가 test 진단 scope가 아니면(문제에 묶이면) 받은
// 것으로 세지 않는다. host를 띄울 수 없으면 view가 null이라 화면 있는 app test는 pass가 아니고,
// host가 판정하지 못하면(exit 2–4·기한·잘못된 관측) 판정 불가다.
import type { Result } from "../../../base/mod.ts";
import type {
  AcceptedReport,
  ObserveExceptionInput,
} from "../../../contracts/problems/mod.ts";
import type { ScreenTestObservation } from "../../../contracts/shell/screen-test.ts";
import {
  type ReceivedReport,
  type ViewDriver,
  ViewHostInconclusive,
} from "../harness/driver.ts";

export type ScreenHostResult =
  | { kind: "observation"; observation: ScreenTestObservation }
  // host 실행 파일을 띄울 수 없다.
  | { kind: "unavailable"; reason: string }
  // 띄웠지만 판정할 수 없게 끝났다.
  | { kind: "inconclusive"; reason: string };

export type ScreenFeedbackFacts =
  ScreenTestObservation["feedback_check"][number];

// 그 요청의 mode와 진단 scope. host 관측은 이것을 못 바꾼다.
export type ScreenReportTarget = { mode: "test"; scope: string };

// runner가 collector에 넘기는 통로.
export type ScreenReportSink = {
  exception(
    input: ObserveExceptionInput,
    target: ScreenReportTarget,
  ): Promise<Result<AcceptedReport>>;
  feedback(
    facts: ScreenFeedbackFacts,
    target: ScreenReportTarget,
  ): Promise<Result<AcceptedReport>>;
};

export type ViewDriverOptions = {
  // host를 한 번 돌린다. 화면 검사 한 번이 모든 화면을 본다.
  run: () => Promise<ScreenHostResult>;
  sink: ScreenReportSink;
  scope: string;
  newReportId: () => string;
  now: () => string;
};

function accepted(
  result: Result<AcceptedReport>,
  scope: string,
): string | null {
  if (!result.ok) return null;
  const value = result.value;
  return value.problem === null && value.diagnostic_scope === scope
    ? value.report
    : null;
}

function received(code: string, reportId: string): ReceivedReport {
  return { report_id: reportId, code, invocation_id: null, stored: "" };
}

// 깨진 view: load가 안 됐거나 오류를 낸 화면.
export function brokenScreens(observation: ScreenTestObservation): string[] {
  const broken = new Set<string>();
  for (const load of observation.load) if (!load.ok) broken.add(load.screen);
  for (const error of observation.errors) broken.add(error.screen);
  return [...broken];
}

// host를 한 번 돌려 ViewDriver를 만든다. 화면 검사를 띄울 수 없으면 null이다.
export async function openViewDriver(
  options: ViewDriverOptions,
): Promise<ViewDriver | null> {
  const host = await options.run();
  if (host.kind === "unavailable") return null;
  if (host.kind === "inconclusive") {
    const inconclusive = () =>
      Promise.reject(new ViewHostInconclusive(host.reason));
    return { exception: inconclusive, feedback: inconclusive };
  }
  const { observation } = host;
  const target: ScreenReportTarget = { mode: "test", scope: options.scope };
  let exceptions: Promise<ReceivedReport[]> | undefined;
  let feedback: Promise<ReceivedReport[]> | undefined;
  return {
    exception() {
      exceptions ??= (async () => {
        const reports: ReceivedReport[] = [];
        for (const error of observation.errors) {
          const id = options.newReportId();
          const result = await options.sink.exception({
            report_id: id,
            observed_at: options.now(),
            observation: error.observation,
            error: {
              name: error.name,
              message: error.message,
              message_missing_reason: error.message === null
                ? { reason: "view error without message" }
                : null,
              stack: null,
              stack_missing_reason: { reason: "screen test host has no stack" },
            },
            error_missing_reason: null,
            invocation: null,
          }, target);
          const report = accepted(result, options.scope);
          if (report !== null) reports.push(received("_exception", report));
        }
        // 관측한 오류가 하나라도 접수되지 않았으면 수집 경로가 빠진 것이다.
        return reports.length === observation.errors.length ? reports : [];
      })();
      return exceptions;
    },
    feedback() {
      feedback ??= (async () => {
        const reports: ReceivedReport[] = [];
        const broken = new Set(brokenScreens(observation));
        for (const facts of observation.feedback_check) {
          if (
            !broken.has(facts.screen) || !facts.binding ||
            facts.dialog !== "opened"
          ) continue;
          const report = accepted(
            await options.sink.feedback(facts, target),
            options.scope,
          );
          if (report !== null) reports.push(received("_feedback", report));
        }
        // 깨진 화면마다 feedback 경로가 접수돼야 한다. 하나라도 빠지면 경로가 없는 것이다.
        return broken.size > 0 && reports.length === broken.size ? reports : [];
      })();
      return feedback;
    },
  };
}
