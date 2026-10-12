// reproduction 판정이다(problems/problem-codes#R10). runner가 시작한
// before·after 실행의 lifecycle과 harness의 관측 frame, 고정 근거(blueprint 선언·source의 보고 호출)를
// 함께 읽어 pass·fail·inconclusive를 정한다. 관측한 값은 runner가 같은 고정 증상 정의로 다시 판정해
// harness가 쓴 symptom_reproduced·expectation_met와 어긋나면 판정 불가다.
import type {
  TestObservationFrame,
  TestResult,
} from "../../../../protocol/problems/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  type ObservedProbe,
  type ReproductionScenario,
  type SymptomParts,
  symptomParts,
} from "./scenario.ts";

export const SYMPTOM_FRAME = "symptom";
export const ADJACENT_FRAME = "adjacent:";
// app driver가 기록 대상이 없는 호출에 돌려주는 자리 표시자다.
const NOT_RECORDED = "inv_not_recorded";

export type ReproductionSide = "before" | "after";

// 한 side의 실제 실행이다. 시작한 side만 있다.
export type SideRun = {
  side: ReproductionSide;
  bundle_hash: string;
  // runner가 직접 관측한 종료.
  end_reason: "exited" | "timeout" | "killed" | "runner_lost";
  // 자식이 관측 protocol을 끝까지 지켰는지(frame이 있고 byte 한도 안이며 hash가 맞다).
  protocol_ok: boolean;
  exit_code: number | null;
  frames: readonly TestObservationFrame[];
  // 고정 bundle에서 runner가 직접 읽은 근거다. harness가 낸 값이 아니다.
  evidence: {
    declared_codes: string[];
    report_literals: string[];
  };
};

export type SideObservation = {
  symptom_reproduced: boolean;
  expectation_met: boolean;
  failure_present: boolean;
  report_seen: boolean;
  actual_hash: string | null;
  reason: string;
};

export type ReproductionObservations = {
  kind: "reproduction";
  // 원래 증상: 고친 쪽과 이전 쪽 각각 같은 고정 증상 정의로 판정한 값.
  original_symptom: Partial<Record<ReproductionSide, SideObservation>>;
  // 변경 후 기대: 같은 고정 기대와 이 side의 값이 맞았는지, 기대 자체가 같았는지.
  changed_expectation: {
    frozen_expectation_hash: string;
    sides: Partial<
      Record<
        ReproductionSide,
        { met: boolean; expectation_hash: string | null }
      >
    >;
  };
  // 인접 불변식은 원래 증상과 따로 읽는다.
  adjacent_invariants: {
    side: ReproductionSide;
    name: string;
    held: boolean;
    actual_hash: string | null;
  }[];
  weakening: {
    checks: { name: string; status: "ok" | "weakened"; reason: string }[];
    found: string[];
  };
  // 외부 효과 사실은 apps/invocations가 가진다. 여기에는 호출 참조만 둔다.
  external_effects: {
    invocations: { side: ReproductionSide; invocation: string }[];
  };
  // 격리 사실. runner가 직접 확인한 값이다. 운영 DB 복사와 실계정 재전송은 없다.
  isolation: {
    sides: {
      side: ReproductionSide;
      fresh_fixture: boolean;
      source_read_only: boolean;
    }[];
    operating_db_copied: false;
    real_account_resend: false;
    effects: string;
  };
  execution_not_started?: { side: ReproductionSide; reason: string };
  scope: string;
};

export type ReproductionJudgment = {
  result: TestResult;
  reason: string;
  observations: ReproductionObservations;
  // blob 준비용 원문. observations에는 hash만 간다.
  actuals: Record<string, unknown>;
};

const SCOPE =
  "고정한 증상 정의와 입력의 범위만 증명한다. 인접 불변식은 별도 항목이고 외부 효과 사실은 apps/invocations 참조로만 가리킨다. 다른 입력·환경의 수리 여부는 증명하지 않는다";

type Parsed = {
  seen: ObservedProbe;
  parts: SymptomParts;
  actual: Record<string, unknown>;
  expectation_hash: string | null;
};

function isProbe(value: unknown): value is ObservedProbe {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (item.outcome === "ok" || item.outcome === "error") &&
    typeof item.status === "number" &&
    Array.isArray(item.report_codes) &&
    item.report_codes.every((code) => typeof code === "string") &&
    typeof item.invocation_id === "string";
}

// 한 side의 frame을 읽는다. protocol이 어긋나면 이유를 돌려준다.
function readSide(
  scenario: ReproductionScenario,
  run: SideRun,
  testHash: string,
):
  | {
    ok: true;
    symptom: Parsed;
    adjacent: { name: string; held: boolean; actual_hash: string }[];
  }
  | { ok: false; reason: string } {
  const names = new Map<string, TestObservationFrame>();
  for (const frame of run.frames) {
    if (frame.side !== run.side || frame.test_hash !== testHash) {
      return {
        ok: false,
        reason:
          `${run.side}: 관측 frame의 side나 test hash가 시작한 대상과 다르다`,
      };
    }
    if (names.has(frame.name)) {
      return { ok: false, reason: `${run.side}: 같은 관측이 겹친다` };
    }
    names.set(frame.name, frame);
  }
  const expected = new Set([
    SYMPTOM_FRAME,
    ...scenario.adjacent.map((item) => `${ADJACENT_FRAME}${item.name}`),
  ]);
  for (const name of names.keys()) {
    if (!expected.has(name)) {
      return { ok: false, reason: `${run.side}: 계획에 없는 관측이다` };
    }
  }
  const symptomFrame = names.get(SYMPTOM_FRAME);
  if (!symptomFrame) {
    return { ok: false, reason: `${run.side}: 원래 증상의 관측이 없다` };
  }
  const actual = symptomFrame.actual as Record<string, unknown> | null;
  if (
    actual === null || typeof actual !== "object" || Array.isArray(actual) ||
    !isProbe(actual.observed) ||
    symptomFrame.symptom_reproduced === undefined ||
    symptomFrame.expectation_met === undefined
  ) {
    return {
      ok: false,
      reason: `${run.side}: 원래 증상 관측이 증상 형식을 갖추지 않았다`,
    };
  }
  const seen = actual.observed as ObservedProbe;
  const parts = symptomParts(scenario, seen);
  if (
    parts.symptom_reproduced !== symptomFrame.symptom_reproduced ||
    parts.expectation_met !== symptomFrame.expectation_met
  ) {
    return {
      ok: false,
      reason:
        `${run.side}: harness가 쓴 판정이 runner가 같은 고정 증상 정의로 다시 낸 판정과 다르다`,
    };
  }
  const adjacent: { name: string; held: boolean; actual_hash: string }[] = [];
  for (const item of scenario.adjacent) {
    const frame = names.get(`${ADJACENT_FRAME}${item.name}`);
    const body = frame?.actual as Record<string, unknown> | null | undefined;
    if (
      !frame || body === null || typeof body !== "object" ||
      Array.isArray(body) || !isProbe(body.observed) ||
      frame.expectation_met === undefined
    ) {
      return {
        ok: false,
        reason: `${run.side}: 인접 불변식 ${item.name}의 관측이 없다`,
      };
    }
    // 인접 불변식도 runner가 고정 조건으로 다시 판정한다.
    const held = symptomParts(
      { ...scenario, expectation: item.holds },
      body.observed as ObservedProbe,
    ).expectation_met;
    if (held !== frame.expectation_met) {
      return {
        ok: false,
        reason:
          `${run.side}: 인접 불변식 ${item.name}의 판정이 runner의 재판정과 다르다`,
      };
    }
    adjacent.push({
      name: item.name,
      held,
      actual_hash: canonicalHash(frame.actual),
    });
  }
  return {
    ok: true,
    symptom: {
      seen,
      parts,
      actual,
      expectation_hash: typeof actual.expectation_hash === "string"
        ? actual.expectation_hash
        : null,
    },
    adjacent,
  };
}

function lifecycleReason(run: SideRun): string | null {
  if (run.end_reason !== "exited") {
    return `${run.side}: 실행이 ${run.end_reason}로 끝나 판정할 수 없다`;
  }
  if (!run.protocol_ok) {
    return `${run.side}: 관측 protocol이 어긋나거나 빠져 판정할 수 없다`;
  }
  if (run.exit_code !== 0) {
    return `${run.side}: test 자식이 비정상 종료(${run.exit_code})해 판정할 수 없다`;
  }
  return null;
}

export function judgeReproduction(input: {
  scenario: ReproductionScenario;
  test_hash: string;
  before: SideRun | null;
  after: SideRun | null;
  // runner가 side마다 직접 확인한 격리 사실이다.
  isolation?: {
    side: ReproductionSide;
    fresh_fixture: boolean;
    source_read_only: boolean;
  }[];
  // 시작하지 않은 side와 그 이유. 한쪽만 시작했을 때만 있다.
  not_started?: { side: ReproductionSide; reason: string };
}): ReproductionJudgment {
  const { scenario } = input;
  const frozenExpectation = canonicalHash(scenario.expectation);
  const observations: ReproductionObservations = {
    kind: "reproduction",
    original_symptom: {},
    changed_expectation: {
      frozen_expectation_hash: frozenExpectation,
      sides: {},
    },
    adjacent_invariants: [],
    weakening: { checks: [], found: [] },
    external_effects: { invocations: [] },
    isolation: {
      sides: input.isolation ?? [],
      operating_db_copied: false,
      real_account_resend: false,
      effects:
        "replay·고정 대역(apps/preview)만 쓰고 실제 서비스에 접속하지 않았다",
    },
    scope: SCOPE,
  };
  const actuals: Record<string, unknown> = {};
  const inconclusive = (reason: string): ReproductionJudgment => ({
    result: "inconclusive",
    reason,
    observations,
    actuals,
  });

  const missing = input.before === null
    ? "before"
    : input.after === null
    ? "after"
    : null;
  if (missing !== null || input.not_started) {
    const side = input.not_started?.side ?? missing!;
    const reason = input.not_started?.reason ?? "시작하지 않았다";
    observations.execution_not_started = { side, reason };
  }

  const runs = [input.before, input.after].filter((run) =>
    run !== null
  ) as SideRun[];
  const parsed = new Map<ReproductionSide, ReturnType<typeof readSide>>();
  const problems: string[] = [];
  for (const run of runs) {
    const lifecycle = lifecycleReason(run);
    if (lifecycle) {
      problems.push(lifecycle);
      continue;
    }
    const read = readSide(scenario, run, input.test_hash);
    parsed.set(run.side, read);
    if (!read.ok) {
      problems.push(read.reason);
      continue;
    }
    const { symptom, adjacent } = read;
    const part = symptom.parts;
    observations.original_symptom[run.side] = {
      symptom_reproduced: part.symptom_reproduced,
      expectation_met: part.expectation_met,
      failure_present: part.failure_present,
      report_seen: part.report_seen,
      actual_hash: canonicalHash(symptom.actual),
      reason: part.symptom_reproduced
        ? "원래 증상이 재현됐다"
        : part.expectation_met
        ? "원래 증상이 없고 기대가 충족됐다"
        : part.failure_present
        ? "업무 증상은 남았지만 원래 problem code 보고가 접수되지 않았다"
        : "원래 증상과 다른 결과다",
    };
    observations.changed_expectation.sides[run.side] = {
      met: part.expectation_met,
      expectation_hash: symptom.expectation_hash,
    };
    actuals[`${run.side}:${SYMPTOM_FRAME}`] = symptom.actual;
    // 기록된 호출만 참조한다. 준비 전 test 프로세스의 읽기는 기록 대상이 없어 자리 표시자가 온다.
    if (symptom.seen.invocation_id !== NOT_RECORDED) {
      observations.external_effects.invocations.push({
        side: run.side,
        invocation: symptom.seen.invocation_id,
      });
    }
    for (const item of adjacent) {
      observations.adjacent_invariants.push({
        side: run.side,
        name: item.name,
        held: item.held,
        actual_hash: item.actual_hash,
      });
    }
    for (const frame of run.frames) {
      if (frame.name !== SYMPTOM_FRAME) {
        actuals[`${run.side}:${frame.name}`] = frame.actual;
      }
    }
  }

  if (observations.execution_not_started) {
    const { side, reason } = observations.execution_not_started;
    return inconclusive(
      `${side}를 시작하지 않았다: ${reason}${
        problems.length > 0 ? ` (${problems.join("; ")})` : ""
      }`,
    );
  }
  if (problems.length > 0) return inconclusive(problems.join("; "));
  const unisolated = observations.isolation.sides.filter((item) =>
    !item.fresh_fixture || !item.source_read_only
  );
  if (unisolated.length > 0) {
    return inconclusive(
      `격리를 확인하지 못했다(새 fixture DB·읽기 전용 source): ${
        unisolated.map((item) => item.side).join(", ")
      }`,
    );
  }

  const before = input.before!;
  const after = input.after!;
  const b = parsed.get("before")!;
  const a = parsed.get("after")!;
  if (!b.ok || !a.ok) return inconclusive("관측을 읽을 수 없다");

  // 약화 검사: 고정된 이전·이후 근거만 쓴다.
  const check = (
    name: string,
    weakened: boolean,
    reason: string,
    kept: string,
  ) => {
    observations.weakening.checks.push({
      name,
      status: weakened ? "weakened" : "ok",
      reason: weakened ? reason : kept,
    });
    if (weakened) observations.weakening.found.push(reason);
  };
  const code = scenario.problem_code;
  check(
    "problem_code_kept",
    before.evidence.declared_codes.includes(code) &&
      !after.evidence.declared_codes.includes(code),
    `원래 problem code ${code}의 선언이 고친 묶음에서 삭제됐다`,
    `원래 problem code ${code}의 선언이 고친 묶음에도 있다`,
  );
  check(
    "report_call_kept",
    before.evidence.report_literals.includes(code) &&
      !after.evidence.report_literals.includes(code),
    `원래 problem code ${code}의 보고 호출이 고친 source에서 삭제됐다`,
    `원래 problem code ${code}의 보고 호출이 고친 source에도 있다`,
  );
  check(
    "report_path_alive",
    b.symptom.parts.report_seen && a.symptom.parts.failure_present &&
      !a.symptom.parts.report_seen,
    `업무 증상은 그대로인데 원래 problem code ${code}의 보고가 접수되지 않는다(보고 경로 삭제)`,
    "보고 경로가 삭제된 흔적이 없다",
  );
  check(
    "expectation_kept",
    [b.symptom.expectation_hash, a.symptom.expectation_hash].some((hash) =>
      hash !== frozenExpectation
    ),
    "관측에 쓴 기대가 고정한 기대와 다르다(기대 약화)",
    "양쪽 관측이 고정한 기대로 판정됐다",
  );
  const weakened = observations.weakening.found;

  const was = b.symptom.parts;
  const now = a.symptom.parts;
  if (!was.symptom_reproduced) {
    return inconclusive(
      was.expectation_met
        ? "before도 기대를 충족해 원래 증상을 재현하지 못했다"
        : "before가 원래 증상과 다른 실패다(같은 증상이 아니다)",
    );
  }
  if (weakened.length > 0) {
    return inconclusive(
      `약화가 있어 수리 증거가 아니다: ${weakened.join("; ")}`,
    );
  }
  const brokenAdjacent = observations.adjacent_invariants.filter((item) =>
    item.side === "after" && !item.held
  );
  if (now.symptom_reproduced) {
    return {
      result: "fail",
      reason: "after에도 원래 증상이 그대로 남아 있다",
      observations,
      actuals,
    };
  }
  if (!now.expectation_met) {
    const sameName = b.symptom.seen.error_name !== null &&
      b.symptom.seen.error_name === a.symptom.seen.error_name;
    return inconclusive(
      sameName
        ? "after의 오류가 이름만 같고 원래 증상과 다른 실패다"
        : "after가 기대를 충족하지 않고 원래 증상도 아닌 다른 실패다",
    );
  }
  if (brokenAdjacent.length > 0) {
    return inconclusive(
      `인접 불변식이 깨졌다: ${
        brokenAdjacent.map((item) => item.name).join(", ")
      }`,
    );
  }
  return {
    result: "pass",
    reason:
      "before가 원래 증상을 재현하고 after가 같은 기대를 충족하며 약화가 없다",
    observations,
    actuals,
  };
}
