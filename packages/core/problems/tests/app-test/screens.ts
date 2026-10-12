// 화면 검사(reporting#R5 view 쪽). shell의 앱 화면 검사
// host가 돌려준 관측을 runner가 그 요청의 mode=test·scope로 보고 접수에 넘기고, 접수된 것만
// harness의 ViewDriver 보고로 돌려준다. 접수가 test 진단 scope가 아니면(문제에 묶이면) 받은
// 것으로 세지 않는다. host를 띄울 수 없으면 view가 null이라 화면 있는 app test는 pass가 아니고,
// host가 판정하지 못하면(exit 2–4·기한·잘못된 관측) 판정 불가다.
import type { Result } from "../../../../base/mod.ts";
import type {
  AcceptedReport,
  ObserveExceptionInput,
} from "../../../../protocol/problems/mod.ts";
import type { ScreenTestObservation } from "../../../../protocol/shell/mod.ts";
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
  // host를 한 번 돌린다. 화면 검사 한 번이 모든 화면을 본다. nonce는 host에 probe_nonce로 준다.
  run: (nonce: string) => Promise<ScreenHostResult>;
  // 이 실행의 probe nonce. runner가 실행마다 정하고 bundle 화면은 모른다.
  nonce: string;
  // 그 화면에 루트 오류 경계(render 오류 event를 내는 AppErrorBoundary)가 있는가.
  has_boundary: (screen: string) => boolean;
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

export const PROBE_KINDS = [
  "error",
  "unhandledrejection",
  "render_error",
] as const;

// host preload가 일으키는 probe 오류의 message. runner nonce가 들어 있다.
export function probeText(nonce: string, kind: string): string {
  return `lophn-probe:${nonce}:${kind}`;
}

// host를 한 번 돌려 ViewDriver를 만든다. 화면 검사를 띄울 수 없으면 null이다.
//
// view_exception: runner가 host preload로 load된 화면마다 오류 probe 셋(error·unhandledrejection·
// render_error)을 일으킨다. 화면마다 셋이 nonce와 함께 관측되고(render_error는 화면에 루트 오류
// 경계가 있어야 한다), 관측된 오류 전부(화면 자신의 실제 오류 포함)가 test scope로 접수돼야 한다.
// feedback: host가 일부러 멈춘 화면과 load에 실패한 화면마다 binding·dialog·접수가 모두 있어야 한다.
// host가 renderer를 멈추지 못했으면(induced가 없으면) 통과하지 못한다.
export async function openViewDriver(
  options: ViewDriverOptions,
): Promise<ViewDriver | null> {
  const host = await options.run(options.nonce);
  if (host.kind === "unavailable") return null;
  if (host.kind === "inconclusive") {
    const inconclusive = () =>
      Promise.reject(new ViewHostInconclusive(host.reason));
    return { exception: inconclusive, feedback: inconclusive };
  }
  const { observation } = host;
  const target: ScreenReportTarget = { mode: "test", scope: options.scope };
  const loaded = observation.load.filter((item) => item.ok).map((item) =>
    item.screen
  );
  let exceptions: Promise<ReceivedReport[]> | undefined;
  let feedback: Promise<ReceivedReport[]> | undefined;
  return {
    exception() {
      exceptions ??= (async () => {
        const probed = loaded.length > 0 &&
          loaded.every((screen) =>
            PROBE_KINDS.every((kind) =>
              (kind !== "render_error" || options.has_boundary(screen)) &&
              observation.errors.some((error) =>
                error.screen === screen && error.observation === kind &&
                (error.message ?? "").includes(probeText(options.nonce, kind))
              )
            )
          );
        if (!probed) return [];
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
        const induced = observation.feedback_check.filter((facts) =>
          facts.induced === true
        );
        // host가 renderer를 멈추지 못했으면 깨진 view를 만들지 못한 것이다.
        if (induced.length === 0) return [];
        const broken = new Set([
          ...induced.map((facts) => facts.screen),
          ...observation.load.filter((item) => !item.ok).map((item) =>
            item.screen
          ),
        ]);
        const reports: ReceivedReport[] = [];
        for (const screen of broken) {
          const facts = observation.feedback_check.find((item) =>
            item.screen === screen
          );
          if (!facts || !facts.binding || facts.dialog !== "opened") continue;
          const report = accepted(
            await options.sink.feedback(facts, target),
            options.scope,
          );
          if (report !== null) reports.push(received("_feedback", report));
        }
        // 깨진 화면마다 feedback 경로가 접수돼야 한다. 하나라도 빠지면 경로가 없는 것이다.
        return reports.length === broken.size ? reports : [];
      })();
      return feedback;
    },
  };
}
