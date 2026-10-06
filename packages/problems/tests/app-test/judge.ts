import type {
  TestObservationFrame,
  TestResult,
} from "../../../contracts/problems/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  isFailurePathName,
  VIEW_HOST_INCONCLUSIVE,
} from "../harness/definitions.ts";
import type { AppTestPlan, PlanCheck } from "./generate.ts";

export type CheckObservation = {
  name: string;
  status: "pass" | "fail" | "not_applicable";
  reason: string;
  // 관측 actual의 hash만 넣는다. 원문은 runner가 redaction 뒤 blob으로 준비한다.
  evidence: { actual_hash: string | null; source: "runner" | "harness" };
};

export type AppTestObservations = {
  platform_checks_hash: string;
  checks: CheckObservation[];
  meaning_changes: AppTestPlan["meaning_changes"];
  // 통과가 증명하는 범위(problems/tests#R12).
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
  "필수 보고 경로와 선언 검사의 고정 기준·입력만 증명한다. 앱 계약 검사와 인접 기능은 별도 관측이다";

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
      },
      actual: frame.actual,
    };
  }
  let met = frame.expectation_met === true;
  let reason = frame.reason;
  if (met && isFailurePathName(check.name)) {
    const record = actual as Record<string, unknown>;
    // SDK를 직접 부른 보고나 다른 code의 보고는 실제 실패 경로가 아니다.
    if (
      record.via !== "command" || record.code !== check.code ||
      typeof record.report_id !== "string" || record.report_id === ""
    ) {
      met = false;
      reason = "실제 command의 실패 경로로 접수된 근거가 아니다";
    }
  }
  return {
    observation: {
      name: check.name,
      status: met ? "pass" : "fail",
      reason,
      evidence: base,
    },
    actual: frame.actual,
  };
}

// 모든 필수 검사가 실제로 pass일 때만 pass다. stdout의 문자열이나 파일은 보지
// 않는다. 관측 protocol이 어긋나면(다른 side·hash, 계획에 없는 이름, 겹친 이름,
// 빠진 expectation) 판정 불가이고, 필수 검사의 관측이 없거나 실패면 fail이다
// (problems/tests#R6, R7, R19; problem-codes#R8, R9).
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
    meaning_changes: plan.meaning_changes,
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
    if (!known.has(frame.name)) {
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
      });
      actuals[check.name] = check.precomputed.evidence;
      continue;
    }
    const judged = fromFrame(check, names.get(check.name));
    checks.push(judged.observation);
    if (judged.actual !== undefined) actuals[check.name] = judged.actual;
  }
  const failed = checks.filter((check) => check.status === "fail");
  const value = observations(checks);
  // 화면 검사 host가 판정하지 못했으면 fail이 아니라 판정 불가다(problems/tests#R7).
  const unjudged = plan.checks.filter((check) => {
    const actual = actuals[check.name] as Record<string, unknown> | undefined;
    return check.source === "harness" &&
      actual?.view_host === VIEW_HOST_INCONCLUSIVE;
  });
  if (unjudged.length > 0) {
    return {
      result: "inconclusive",
      reason: `화면 검사 host가 판정하지 못했다: ${
        unjudged.map((check) => check.name).join(", ")
      }`,
      observations: value,
      actuals,
    };
  }
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
  return {
    result: "pass",
    reason: "모든 필수 검사가 실제로 통과했다",
    observations: value,
    actuals,
  };
}
