// reproduction test의 고정 시험(FrozenTest)에 들어가는 증상 정의다(problems/tests#R10, R12). 같은
// 정의를 before·after 양쪽에 그대로 적용한다. 앱 source에서 오지 않고 접수 때 고정된 값이라 앱이 낮출 수 없다.
import { canonicalHash } from "../canonical.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// command 한 번의 관측이 이 모양인지 묻는 조건이다. 적은 항목은 모두 맞아야 한다.
export type Matcher = {
  // 응답 상태. 정상 응답은 200이다.
  status?: number;
  // 응답 `error.code`.
  error_code?: string;
  // 앱이 낸 오류 이름(처리되지 않은 예외의 name). 같은 이름만으로는 같은 증상이 아니다.
  error_name?: string;
  // 응답 본문의 값(object key 경로).
  body?: { path: string[]; equals: JsonValue }[];
};

// 한 번의 command 호출을 관측한 사실이다. harness가 만들고 runner가 같은 값으로 다시 판정한다.
export type ObservedProbe = {
  outcome: "ok" | "error";
  status: number;
  error_code: string | null;
  error_name: string | null;
  // 이 호출에서 접수된 보고의 code.
  report_codes: string[];
  // 호출한 invocation ID(외부 효과가 있으면 apps/invocations가 이 ID로 사실을 가진다).
  invocation_id: string;
  body: JsonValue;
};

export type ReproductionScenario = {
  // 원래 보고의 problem code. 이 code가 접수되는 것이 원래 증상의 일부다.
  problem_code: string;
  probe: {
    command: string;
    input: JsonValue;
    fault?: "store" | "net" | "none";
  };
  // 원래 증상: 업무 응답이 이 모양이고 problem_code 보고가 접수된다.
  symptom: Matcher;
  // 고친 뒤 기대: 같은 입력에서 응답이 이 모양이다.
  expectation: Matcher;
  // 고치면서 건드리지 않아야 하는 인접 기능이다. 원래 증상과 따로 관측한다.
  adjacent: {
    name: string;
    command: string;
    input: JsonValue;
    holds: Matcher;
  }[];
};

export type ReproductionFrozen = {
  // FrozenTest.input / expected / symptom에 hash로 묶이는 값이다.
  input: string;
  expected: string;
  symptom: string;
};

const get = (value: unknown, path: readonly string[]): unknown => {
  let at = value;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
};

export function matches(matcher: Matcher, seen: ObservedProbe): boolean {
  if (matcher.status !== undefined && matcher.status !== seen.status) {
    return false;
  }
  if (
    matcher.error_code !== undefined && matcher.error_code !== seen.error_code
  ) return false;
  if (
    matcher.error_name !== undefined && matcher.error_name !== seen.error_name
  ) return false;
  return (matcher.body ?? []).every((item) =>
    canonicalHash(get(seen.body, item.path) ?? null) ===
      canonicalHash(item.equals)
  );
}

export function reproductionFrozen(
  scenario: ReproductionScenario,
): ReproductionFrozen {
  return {
    input: canonicalHash({
      probe: scenario.probe,
      adjacent: scenario.adjacent.map(({ name, command, input }) => ({
        name,
        command,
        input,
      })),
    }),
    expected: canonicalHash({
      expectation: scenario.expectation,
      adjacent: scenario.adjacent.map(({ name, holds }) => ({ name, holds })),
    }),
    symptom: canonicalHash({
      problem_code: scenario.problem_code,
      symptom: scenario.symptom,
    }),
  };
}

// 관측한 값 하나가 원래 증상의 각 부분과 얼마나 맞는지다. 약화 검사는 이 부분들을 따로 본다.
export type SymptomParts = {
  // 업무 응답이 원래 증상의 모양이다.
  failure_present: boolean;
  // 원래 problem code의 보고가 접수됐다.
  report_seen: boolean;
  symptom_reproduced: boolean;
  expectation_met: boolean;
};

export function symptomParts(
  scenario: ReproductionScenario,
  seen: ObservedProbe,
): SymptomParts {
  const failure_present = matches(scenario.symptom, seen);
  const report_seen = seen.report_codes.includes(scenario.problem_code);
  return {
    failure_present,
    report_seen,
    symptom_reproduced: failure_present && report_seen,
    expectation_met: matches(scenario.expectation, seen),
  };
}
