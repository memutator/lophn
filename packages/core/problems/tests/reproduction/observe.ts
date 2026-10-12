// reproduction test 자식(플랫폼 harness)의 본문이다. runner가 쥔 AppDriver를 private 호출 통로로만 만져
// 고정 증상 정의의 probe와 인접 command를 한 번씩 부르고, 관측 frame을 낸다(problems/tests#R10, R12, R15).
// 앱 code·DB·net은 직접 만지지 않는다. 외부 접속은 runner가 연 고정 대역뿐이다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { canonicalHash } from "../canonical.ts";
import type { AppDriver, InvokeResult } from "../harness/driver.ts";
import type { Emitter } from "../harness/emit.ts";
import {
  type JsonValue,
  type ObservedProbe,
  type ReproductionScenario,
  symptomParts,
} from "./scenario.ts";
import { ADJACENT_FRAME, SYMPTOM_FRAME } from "./judge.ts";

const BODY_LIMIT = 4_000;

function compact(body: unknown): JsonValue {
  const value = (body ?? null) as JsonValue;
  const text = JSON.stringify(value);
  if (text.length <= BODY_LIMIT) return value;
  return { truncated: true, hash: canonicalHash(value) };
}

// 처리되지 않은 예외로 접수된 보고에서 오류 이름을 읽는다. 없으면 null이다.
function errorNameOf(reports: InvokeResult["reports"]): string | null {
  for (const report of reports) {
    if (report.code !== "_exception") continue;
    const found = /\b([A-Z][A-Za-z]*Error)\b/.exec(report.stored);
    if (found) return found[1];
  }
  return null;
}

export function toObserved(invoked: InvokeResult): ObservedProbe {
  const body = invoked.response?.body as
    | { error?: { code?: string } }
    | null
    | undefined;
  return {
    outcome: invoked.outcome,
    status: invoked.response?.status ?? 0,
    error_code: body?.error?.code ?? null,
    error_name: errorNameOf(invoked.reports),
    report_codes: invoked.reports.map((report) => report.code),
    invocation_id: invoked.invocation_id,
    body: compact(invoked.response?.body),
  };
}

export async function observeReproduction(input: {
  driver: AppDriver;
  scenario: ReproductionScenario;
  emitter: Emitter;
}): Promise<Result<number>> {
  const { driver, scenario, emitter } = input;
  const inject = scenario.probe.fault !== undefined &&
    scenario.probe.fault !== "none";
  const invoked = await driver.invoke(
    scenario.probe.command,
    scenario.probe.input,
    { inject_failure: inject, fault: scenario.probe.fault },
  );
  const seen = toObserved(invoked);
  const parts = symptomParts(scenario, seen);
  const sent = emitter.emit({
    name: SYMPTOM_FRAME,
    actual: {
      observed: seen as unknown as JsonValue,
      expectation_hash: canonicalHash(scenario.expectation),
    },
    symptom_reproduced: parts.symptom_reproduced,
    expectation_met: parts.expectation_met,
    reason: parts.symptom_reproduced
      ? "원래 증상이 재현됐다"
      : parts.expectation_met
      ? "기대가 충족됐다"
      : "원래 증상도 기대도 아니다",
  });
  if (!sent.ok) return sent;
  let count = 1;
  for (const item of scenario.adjacent) {
    const adjacent = toObserved(
      await driver.invoke(item.command, item.input, { inject_failure: false }),
    );
    const held =
      symptomParts({ ...scenario, expectation: item.holds }, adjacent)
        .expectation_met;
    const done = emitter.emit({
      name: `${ADJACENT_FRAME}${item.name}`,
      actual: { observed: adjacent as unknown as JsonValue },
      expectation_met: held,
      reason: held ? "인접 불변식이 유지됐다" : "인접 불변식이 깨졌다",
    });
    if (!done.ok) return done;
    count += 1;
  }
  if (count === 0) {
    return err({ code: "invalid_input", message: "관측이 없다" });
  }
  return ok(count);
}
