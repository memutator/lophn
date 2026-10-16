import type {
  TestObservationFrame,
  TestResult,
} from "../../../../protocol/problems/mod.ts";
import { canonicalHash } from "../canonical.ts";
import type { AppTestPlan, PlanCheck } from "./generate.ts";

// 통과가 증명하는 범위. 검사한 고정 기준과 입력 범위는 runner의 설치 자료다.
type ObservedCoverage = {
  criteria: string[];
  input_range: string;
};

type CheckObservation = {
  name: string;
  status: "pass" | "fail" | "inconclusive" | "not_applicable";
  reason: string;
  // 관측 actual의 hash만 넣는다. 원문은 runner가 redaction 뒤 blob으로 준비한다.
  evidence: { actual_hash: string | null; source: "runner" | "harness" };
  coverage: ObservedCoverage;
};

type AppTestObservations = {
  platform_checks_hash: string;
  checks: CheckObservation[];
  // 통과가 증명하는 범위.
  scope: string;
};

export type AppTestJudgment = {
  result: TestResult;
  reason: string;
  observations: AppTestObservations;
  // blob 준비용 원문. observations에는 hash만 간다.
  actuals: Record<string, unknown>;
};

const SCOPE =
  "검사마다 적은 고정 기준과 입력 범위만 증명한다. 그 밖의 기능과 데이터는 증명하지 않는다";

function coverageFor(check: PlanCheck): ObservedCoverage {
  return {
    criteria: check.coverage.criteria,
    input_range: check.coverage.input_range,
  };
}

function fromFrame(
  check: PlanCheck,
  frame: TestObservationFrame | undefined,
): { observation: CheckObservation; actual: unknown } {
  const harness = "harness" as const;
  if (!frame) {
    return {
      observation: {
        name: check.name,
        status: "fail",
        reason: "필수 검사의 관측이 없다. 검사가 빠졌거나 실행되지 않았다",
        evidence: { actual_hash: null, source: harness },
        coverage: coverageFor(check),
      },
      actual: undefined,
    };
  }
  const actual = frame.actual as Record<string, unknown> | null;
  const hash = canonicalHash(frame.actual);
  const digest = actual && typeof actual === "object" && !Array.isArray(actual)
    ? actual.check_digest
    : undefined;
  const base = { actual_hash: hash, source: harness };
  if (digest !== check.digest) {
    return {
      observation: {
        name: check.name,
        status: "fail",
        reason: "검사 정의가 runner의 설치 자료와 다르다",
        evidence: base,
        coverage: coverageFor(check),
      },
      actual: frame.actual,
    };
  }
  return {
    observation: {
      name: check.name,
      status: frame.expectation_met === true ? "pass" : "fail",
      reason: frame.reason,
      evidence: base,
      coverage: coverageFor(check),
    },
    actual: frame.actual,
  };
}

// 모든 필수 검사가 실제로 pass일 때만 pass다. stdout의 문자열이나 파일은 보지
// 않는다. 관측 protocol이 어긋나면(다른 side·hash, 계획에 없는 이름, 겹친 이름,
// 빠진 expectation) 판정 불가이고, 필수 검사의 관측이 없거나 실패면 fail이다.
// 통과로 채우지 못한 검사(inconclusive)가 있으면 실패한 검사가 없어도 판정 불가다.
export function judgeAppTest(input: {
  plan: AppTestPlan;
  test_hash: string;
  frames: readonly TestObservationFrame[];
}): AppTestJudgment {
  const { plan } = input;
  const observations = (
    checks: CheckObservation[],
  ): AppTestObservations => ({
    platform_checks_hash: plan.platform_hash,
    checks,
    scope: SCOPE,
  });
  const inconclusive = (reason: string): AppTestJudgment => ({
    result: "inconclusive",
    reason,
    observations: observations([]),
    actuals: {},
  });
  if (input.frames.length === 0) {
    return inconclusive("관측 frame이 없어 판정할 수 없다");
  }
  const names = new Map<string, TestObservationFrame>();
  const known = new Set(plan.checks.map((check) => check.name));
  for (const frame of input.frames) {
    if (frame.side !== "single" || frame.test_hash !== input.test_hash) {
      return inconclusive(
        "관측 frame의 side나 test hash가 시작한 대상과 다르다",
      );
    }
    if (!known.has(frame.name as never)) {
      return inconclusive("계획에 없는 검사 이름의 관측이다");
    }
    if (names.has(frame.name)) {
      return inconclusive("같은 검사의 관측이 겹친다");
    }
    const plain = frame.actual !== null && typeof frame.actual === "object" &&
      !Array.isArray(frame.actual);
    if (!plain || frame.expectation_met === undefined) {
      return inconclusive("관측 frame이 검사 형식을 갖추지 않았다");
    }
    names.set(frame.name, frame);
  }
  const checks: CheckObservation[] = [];
  const actuals: Record<string, unknown> = {};
  for (const check of plan.checks) {
    if (check.status === "not_applicable") {
      checks.push({
        name: check.name,
        status: "not_applicable",
        reason: check.reason,
        evidence: { actual_hash: null, source: check.source },
        coverage: coverageFor(check),
      });
      continue;
    }
    if (check.source === "runner" && check.precomputed) {
      checks.push({
        name: check.name,
        status: check.precomputed.status,
        reason: check.precomputed.reason,
        evidence: {
          actual_hash: canonicalHash(check.precomputed.evidence),
          source: "runner",
        },
        coverage: coverageFor(check),
      });
      actuals[check.name] = check.precomputed.evidence;
      continue;
    }
    const judged = fromFrame(check, names.get(check.name));
    checks.push(judged.observation);
    if (judged.actual !== undefined) actuals[check.name] = judged.actual;
  }
  const failed = checks.filter((check) => check.status === "fail");
  const unjudged = checks.filter((check) => check.status === "inconclusive");
  const value = observations(checks);
  if (failed.length > 0) {
    return {
      result: "fail",
      reason: `필수 검사 ${failed.length}개가 통과하지 못했다: ${
        failed.map((check) => check.name).join(", ")
      }`,
      observations: value,
      actuals,
    };
  }
  if (unjudged.length > 0) {
    return {
      result: "inconclusive",
      reason: `판정하지 못한 필수 검사가 있다: ${
        unjudged.map((check) => `${check.name}(${check.reason})`).join(", ")
      }`,
      observations: value,
      actuals,
    };
  }
  return {
    result: "pass",
    reason: "모든 필수 검사가 실제로 통과했다",
    observations: value,
    actuals,
  };
}
