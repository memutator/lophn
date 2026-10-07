import { assert, assertEquals } from "@std/assert";
import type { TestObservationFrame } from "../../../contracts/problems/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  ADJACENT_FRAME,
  judgeReproduction,
  type ReproductionSide,
  type SideRun,
  SYMPTOM_FRAME,
} from "./judge.ts";
import {
  type ObservedProbe,
  reproductionFrozen,
  type ReproductionScenario,
  symptomParts,
} from "./scenario.ts";

const scenario: ReproductionScenario = {
  problem_code: "fixture_broken",
  probe: { command: "run_broken", input: { kind: "type_error" } },
  symptom: { status: 500, error_code: "internal", error_name: "TypeError" },
  expectation: { status: 200 },
  adjacent: [{
    name: "mark_kind",
    command: "mark_kind",
    input: { kind: "x" },
    holds: { status: 200 },
  }],
};
const TEST = canonicalHash({ scenario });

const probe = (patch: Partial<ObservedProbe> = {}): ObservedProbe => ({
  outcome: "error",
  status: 500,
  error_code: "internal",
  error_name: "TypeError",
  report_codes: ["fixture_broken", "_exception"],
  invocation_id: "inv_before",
  body: null,
  ...patch,
});
const fixed = (patch: Partial<ObservedProbe> = {}) =>
  probe({
    outcome: "ok",
    status: 200,
    error_code: null,
    error_name: null,
    report_codes: [],
    ...patch,
  });

function frames(
  side: ReproductionSide,
  seen: ObservedProbe,
  options: {
    adjacent?: boolean;
    expectation?: unknown;
    lie?: boolean;
  } = {},
): TestObservationFrame[] {
  const parts = symptomParts(scenario, seen);
  const list: TestObservationFrame[] = [{
    side,
    test_hash: TEST,
    name: SYMPTOM_FRAME,
    actual: {
      observed: seen,
      expectation_hash: canonicalHash(
        options.expectation ?? scenario.expectation,
      ),
    } as never,
    symptom_reproduced: options.lie
      ? !parts.symptom_reproduced
      : parts.symptom_reproduced,
    expectation_met: parts.expectation_met,
    reason: "observed",
  }];
  list.push({
    side,
    test_hash: TEST,
    name: `${ADJACENT_FRAME}mark_kind`,
    actual: { observed: fixed({ invocation_id: `inv_${side}_adj` }) } as never,
    expectation_met: options.adjacent ?? true,
    reason: "adjacent",
  });
  return list;
}

function run(
  side: ReproductionSide,
  seen: ObservedProbe,
  patch: Partial<SideRun> = {},
  options: Parameters<typeof frames>[2] = {},
): SideRun {
  return {
    side,
    bundle_hash: side === "before" ? "b".repeat(64) : "a".repeat(64),
    end_reason: "exited",
    protocol_ok: true,
    exit_code: 0,
    frames: frames(side, seen, options),
    evidence: {
      declared_codes: ["fixture_broken", "fixture_misconfigured"],
      report_literals: ["fixture_broken"],
    },
    ...patch,
  };
}

const judge = (before: SideRun | null, after: SideRun | null, extra = {}) =>
  judgeReproduction({
    scenario,
    test_hash: TEST,
    before,
    after,
    ...extra,
  });

Deno.test("problems/tests#R10: before 원증상 재현 + after 같은 기대 충족 + 약화 없음만 pass", () => {
  const done = judge(run("before", probe()), run("after", fixed()));
  assertEquals(done.result, "pass", done.reason);
  assertEquals(done.observations.weakening.found, []);
});

Deno.test("problems/tests#R10: before 재현 + after 같은 증상은 fail", () => {
  const done = judge(
    run("before", probe()),
    run("after", probe({ invocation_id: "inv_after" })),
  );
  assertEquals(done.result, "fail", done.reason);
});

Deno.test("problems/tests#R10: before도 pass이거나 다른 실패이면 inconclusive", () => {
  const passing = judge(run("before", fixed()), run("after", fixed()));
  assertEquals(passing.result, "inconclusive");
  assert(passing.reason.includes("before도"));
  const other = judge(
    run("before", probe({ status: 503, error_code: "unavailable" })),
    run("after", fixed()),
  );
  assertEquals(other.result, "inconclusive");
  assert(other.reason.includes("다른 실패"));
});

Deno.test("problems/tests#R10: after가 다른 실패이거나 오류 이름만 같으면 inconclusive", () => {
  const different = judge(
    run("before", probe()),
    run(
      "after",
      probe({ status: 503, error_code: "unavailable", error_name: null }),
    ),
  );
  assertEquals(different.result, "inconclusive");
  assert(different.reason.includes("다른 실패"));
  const sameName = judge(
    run("before", probe()),
    run("after", probe({ status: 503, error_code: "unavailable" })),
  );
  assertEquals(sameName.result, "inconclusive");
  assert(sameName.reason.includes("이름만 같고"));
});

Deno.test("problems/tests#R10: timeout·killed·관측 protocol 어긋남·비정상 종료는 inconclusive", () => {
  for (
    const patch of [
      { end_reason: "timeout" as const },
      { end_reason: "killed" as const },
      { protocol_ok: false },
      { exit_code: 1 },
    ]
  ) {
    const done = judge(run("before", probe()), run("after", fixed(), patch));
    assertEquals(done.result, "inconclusive", JSON.stringify(patch));
  }
});

Deno.test("problems/tests#R10: harness가 쓴 판정이 runner의 재판정과 다르면 inconclusive", () => {
  const done = judge(
    run("before", probe()),
    run("after", fixed(), {}, { lie: true }),
  );
  assertEquals(done.result, "inconclusive");
  assert(done.reason.includes("재판정") || done.reason.includes("다시 낸"));
});

Deno.test("problems/tests#R11 problems/problem-codes#R10: problem code 선언·보고 호출 삭제는 약화라 inconclusive", () => {
  const removedCode = judge(
    run("before", probe()),
    run("after", fixed(), {
      evidence: {
        declared_codes: ["fixture_misconfigured"],
        report_literals: ["fixture_broken"],
      },
    }),
  );
  assertEquals(removedCode.result, "inconclusive");
  assert(removedCode.reason.includes("선언"));
  const removedCall = judge(
    run("before", probe()),
    run("after", fixed(), {
      evidence: { declared_codes: ["fixture_broken"], report_literals: [] },
    }),
  );
  assertEquals(removedCall.result, "inconclusive");
  assert(removedCall.reason.includes("보고 호출"));
  assertEquals(removedCall.observations.weakening.found.length, 1);
});

Deno.test("problems/tests#R11: 업무 증상은 그대로인데 보고만 사라지면 보고 경로 삭제로 inconclusive", () => {
  const done = judge(
    run("before", probe()),
    run(
      "after",
      probe({ report_codes: ["_exception"], invocation_id: "inv_after" }),
    ),
  );
  assertEquals(done.result, "inconclusive");
  assert(done.reason.includes("보고 경로 삭제"));
  assert(
    done.observations.weakening.checks.some((item) =>
      item.name === "report_path_alive" && item.status === "weakened"
    ),
  );
});

Deno.test("problems/tests#R11: 관측에 쓴 기대가 고정한 기대와 다르면(기대 낮춤) inconclusive", () => {
  const lowered = judge(
    run("before", probe()),
    run("after", fixed(), {}, { expectation: { status: 200, lowered: true } }),
  );
  assertEquals(lowered.result, "inconclusive");
  assert(lowered.reason.includes("기대 약화"));
});

Deno.test("problems/tests#R12: observations는 원래 증상·변경 후 기대·인접 불변식을 따로 두고 외부 효과는 invocation 참조뿐이다", () => {
  const done = judge(run("before", probe()), run("after", fixed()));
  const { observations } = done;
  assertEquals(observations.original_symptom.before?.symptom_reproduced, true);
  assertEquals(observations.original_symptom.after?.symptom_reproduced, false);
  assertEquals(observations.changed_expectation.sides.after?.met, true);
  assertEquals(
    observations.changed_expectation.frozen_expectation_hash,
    canonicalHash(scenario.expectation),
  );
  assertEquals(
    observations.adjacent_invariants.map((
      item,
    ) => [item.side, item.name, item.held]),
    [["before", "mark_kind", true], ["after", "mark_kind", true]],
  );
  assertEquals(
    observations.external_effects.invocations.map((item) => item.side),
    ["before", "after"],
  );
  // 외부 효과 사실의 내용은 observations에 없다. 호출 참조 문자열뿐이다.
  for (const item of observations.external_effects.invocations) {
    assertEquals(Object.keys(item).sort(), ["invocation", "side"]);
  }
  // 인접 불변식이 깨지면 고정 기준을 만족해도 pass가 아니다.
  const broken = judge(
    run("before", probe()),
    run("after", fixed(), {}, { adjacent: false }),
  );
  assertEquals(broken.result, "inconclusive");
  assert(broken.reason.includes("인접 불변식"));
});

Deno.test("problems/tests#R10: 한쪽만 시작하면 시작한 side의 execution과 미시작 이유로 inconclusive", () => {
  const done = judge(run("before", probe()), null, {
    not_started: { side: "after", reason: "after 묶음을 준비하지 못했다" },
  });
  assertEquals(done.result, "inconclusive");
  assertEquals(done.observations.execution_not_started, {
    side: "after",
    reason: "after 묶음을 준비하지 못했다",
  });
  assert(done.observations.original_symptom.before);
  assertEquals(done.observations.original_symptom.after, undefined);
});

Deno.test("problems/tests#R10: 같은 FrozenTest의 증상·기대 정의는 입력이 같으면 같은 hash다", () => {
  assertEquals(
    reproductionFrozen(scenario),
    reproductionFrozen({ ...scenario }),
  );
  assert(
    reproductionFrozen(scenario).expected !==
      reproductionFrozen({ ...scenario, expectation: { status: 201 } })
        .expected,
  );
});

Deno.test("problems/tests#R15: 새 fixture DB나 읽기 전용 source를 확인하지 못한 side가 있으면 inconclusive다", () => {
  const sides = (
    patch: { fresh_fixture?: boolean; source_read_only?: boolean },
  ) => [
    { side: "before" as const, fresh_fixture: true, source_read_only: true },
    {
      side: "after" as const,
      fresh_fixture: true,
      source_read_only: true,
      ...patch,
    },
  ];
  const ok = judge(run("before", probe()), run("after", fixed()), {
    isolation: sides({}),
  });
  assertEquals(ok.result, "pass");
  assertEquals(ok.observations.isolation.operating_db_copied, false);
  assertEquals(ok.observations.isolation.real_account_resend, false);
  for (const patch of [{ fresh_fixture: false }, { source_read_only: false }]) {
    const done = judge(run("before", probe()), run("after", fixed()), {
      isolation: sides(patch),
    });
    assertEquals(done.result, "inconclusive", JSON.stringify(patch));
    assert(done.reason.includes("격리"));
  }
});
