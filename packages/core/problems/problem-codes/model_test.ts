import { assert, assertEquals, assertFalse } from "@std/assert";
import { RESERVED_PROBLEM_CODES } from "../../../protocol/problems/mod.ts";
import type { ProblemCodeDeclaration } from "../../../protocol/problems/mod.ts";
import * as problemCodes from "./mod.ts";
import {
  checkProblemCodeDeclarations,
  observeMeaningChanges,
  type ProblemCodeBundle,
  reportableProblemCodes,
  type RequiredReportPath,
  requiredReportPaths,
  reservedProblemCodes,
} from "./mod.ts";

const base = {
  code: "account_auth",
  message_key: "app-detail.issue.authentication_failed",
  message: "Sign in to your account again.",
  fixer: "user",
};
const declaration = (patch: Partial<ProblemCodeDeclaration> = {}) => ({
  ...base,
  ...patch,
});

function accepted(value: unknown): ProblemCodeDeclaration[] {
  const result = checkProblemCodeDeclarations(value);
  assert(result.ok, "declarations should be accepted");
  return result.value;
}
function rejected(value: unknown) {
  const result = checkProblemCodeDeclarations(value);
  assertFalse(result.ok, "declarations should be rejected");
  assertEquals(result.error.code, "invalid_input");
  return result.error;
}
function required(
  paths: RequiredReportPath[],
  kind: RequiredReportPath["kind"],
  code: string | null,
): RequiredReportPath {
  const found = paths.find((path) => path.kind === kind && path.code === code);
  assert(found, `missing report path ${kind}`);
  return found;
}
const bundle = (patch: Partial<ProblemCodeBundle> = {}): ProblemCodeBundle => ({
  problem_codes: accepted([declaration()]),
  has_view: true,
  ...patch,
});

Deno.test("problems/problem-codes#R1: code는 2~48자 소문자 이름이고 blueprint 안에서 유일하다", () => {
  for (const code of ["ab", "a".repeat(48), "a1", "a_b"]) {
    assertEquals(accepted([declaration({ code })]).length, 1);
  }
  for (
    const code of ["a", "a".repeat(49), "A_code", "a-code", "1_code", "a b"]
  ) {
    rejected([declaration({ code })]);
  }
  rejected([declaration(), declaration()]);
  rejected([
    declaration(),
    declaration({ message_key: "app-detail.issue.other" }),
  ]);
  assertEquals(accepted([]).length, 0);
});

Deno.test("problems/problem-codes#R2: message key·en 한 줄·fixer를 모두 요구하고 치환 자리표시자를 거절한다", () => {
  for (
    const value of [
      declaration({ message_key: "bad" }),
      declaration({ message_key: undefined as unknown as string }),
      declaration({ message: undefined as unknown as string }),
      declaration({
        fixer: undefined as unknown as ProblemCodeDeclaration["fixer"],
      }),
      declaration({ fixer: "agent" as ProblemCodeDeclaration["fixer"] }),
      declaration({ message: " " }),
      declaration({ message: "line\nline" }),
      declaration({ message: "line\rline" }),
      declaration({ message: "Missing {name}." }),
      { ...declaration(), unknown: true },
    ]
  ) rejected([value]);
  for (
    const patch of [
      {},
      { message: "Your profile could not be saved." },
      { message: "Usage was counted a little low.", fixer: "coding_agent" },
    ] as Partial<ProblemCodeDeclaration>[]
  ) accepted([declaration(patch)]);
  // R2 확인의 예: 프로필 기록 누락·사용량 과소집계는 코드 수리, 계정 인증 실패는 사람 조치.
  for (
    const example of [
      {
        code: "profile_save",
        message_key: "app-detail.issue.profile_not_saved",
        message: "Your profile could not be saved.",
        fixer: "coding_agent",
      },
      {
        code: "usage_undercount",
        message_key: "app-detail.issue.usage_undercount",
        message: "Usage was counted a little low.",
        fixer: "coding_agent",
      },
      {
        code: "account_auth",
        message_key: "app-detail.issue.authentication_failed",
        message: "Sign in to your account again.",
        fixer: "user",
      },
    ] as ProblemCodeDeclaration[]
  ) {
    assertEquals(accepted([example])[0].fixer, example.fixer);
  }
  const failure = rejected([declaration({ message: "Missing {name}." })]);
  assertFalse(failure.message.includes("Missing"));
  assertFalse(failure.message.includes("{"));
  assertEquals(failure.details, undefined);
});

Deno.test("problems/problem-codes#R5: `_`로 시작하는 예약 이름은 앱 선언에서 거절한다", () => {
  for (const reserved of RESERVED_PROBLEM_CODES) {
    rejected([declaration({ code: reserved.code })]);
  }
  rejected([declaration({ code: "_custom" })]);
  assertEquals(accepted([declaration()]).length, 1);
});

Deno.test("problems/problem-codes#R6: 예약 3종은 catalog와 같고 앱 선언 0개에서도 별개로 나온다", () => {
  assertEquals(reservedProblemCodes(), [...RESERVED_PROBLEM_CODES]);
  assertEquals(
    reservedProblemCodes().map((reserved) => reserved.code),
    ["_exception", "_feedback", "_invalid_report"],
  );
  const reported = reportableProblemCodes(accepted([]));
  assertEquals(reported.length, 3);
  assertEquals(
    new Set(reported.map((entry) => entry.code)).size,
    3,
    "reserved codes must stay separate",
  );
  assertEquals(
    reported.map((entry) => entry.message_key),
    [
      "app-detail.issue.unexpected_error",
      "app-detail.issue.reported",
      "app-detail.issue.report_incomplete",
    ],
  );
  const withDeclarations = reportableProblemCodes(accepted([declaration()]));
  assertEquals(withDeclarations.length, 4);
  assertEquals(withDeclarations.at(-1)!.code, "_invalid_report");
});

Deno.test("problems/problem-codes#R3: 같은 code의 message·fixer만 의미 변경 확인 대상으로 관측한다", () => {
  const previous = accepted([
    declaration(),
    declaration({ code: "usage_undercount", fixer: "coding_agent" }),
    declaration({ code: "gone", message_key: "app-detail.issue.gone" }),
  ]);
  const current = accepted([
    declaration({ message: "Sign in again to continue." }),
    declaration({ code: "usage_undercount" }),
    declaration({ code: "added", message_key: "app-detail.issue.added" }),
    declaration({
      code: "profile_save",
      message_key: "app-detail.issue.renamed",
    }),
  ]);
  assertEquals(observeMeaningChanges(previous, current), [
    { code: "account_auth", changed: ["message"] },
    { code: "usage_undercount", changed: ["fixer"] },
  ]);
  // 같은 code에서 message_key만 바꾸면 안내 표 이동일 뿐 의미 변경이 아니다.
  assertEquals(
    observeMeaningChanges(
      accepted([
        declaration({
          code: "profile_save",
          message_key: "app-detail.issue.profile_save",
          fixer: "coding_agent",
        }),
      ]),
      accepted([
        declaration({
          code: "profile_save",
          message_key: "app-detail.issue.renamed",
          fixer: "coding_agent",
        }),
      ]),
    ),
    [],
    "message_key-only rename must not be a meaning change",
  );
  assertEquals(
    observeMeaningChanges(
      accepted([declaration()]),
      accepted([
        declaration({
          message: "Sign in again to continue.",
          fixer: "coding_agent",
        }),
      ]),
    ),
    [{ code: "account_auth", changed: ["message", "fixer"] }],
    "changing message and fixer together reports both",
  );
  assertEquals(
    observeMeaningChanges(previous, accepted([declaration()])).length,
    0,
  );
  assertEquals(
    observeMeaningChanges(
      accepted([declaration(), declaration({ code: "usage_undercount" })]),
      accepted([
        declaration({ code: "usage_undercount" }),
        declaration(),
      ]),
    ).length,
    0,
    "order changes are not meaning changes",
  );
  assertEquals(observeMeaningChanges([], current).length, 0);
});

Deno.test("problems/problem-codes#R7: fixer는 안내 데이터일 뿐 권한·claim·닫힘 근거가 되지 않는다", () => {
  for (const name of Object.keys(problemCodes)) {
    for (
      const forbidden of [
        "permission",
        "authoriz",
        "claim",
        "closing",
        "close",
      ]
    ) {
      assertFalse(
        name.toLowerCase().includes(forbidden),
        `${name} must not be an exported fixer-driven decision`,
      );
    }
  }
  const userFixer = accepted([declaration({ fixer: "user" })]);
  const agentFixer = accepted([declaration({ fixer: "coding_agent" })]);
  assertEquals(
    requiredReportPaths(bundle({ problem_codes: userFixer })),
    requiredReportPaths(bundle({ problem_codes: agentFixer })),
  );
  for (
    const path of requiredReportPaths(bundle({ problem_codes: userFixer }))
  ) {
    for (const name of ["permission", "claim", "closing"]) {
      assertFalse(path.reason.includes(name));
      assertFalse(Object.hasOwn(path, name));
    }
  }
});

Deno.test("problems/problem-codes#R8: 선언 0개여도 process 예외·redaction 경로를 남긴다", () => {
  const paths = requiredReportPaths(
    bundle({ problem_codes: accepted([]) }),
  );
  assertEquals(
    paths.filter((path) => path.kind === "failure_path").length,
    0,
  );
  assertEquals(
    required(paths, "process_exception", "_exception").status,
    "required",
  );
  assertEquals(required(paths, "redaction", null).status, "required");
  assertEquals(paths.length, 4);
});

Deno.test("problems/problem-codes#R9: 선언 code마다 실제 실패 경로가 필수로 필요하다", () => {
  const codes = ["profile_save", "usage_undercount"];
  const paths = requiredReportPaths(
    bundle({
      problem_codes: accepted(
        codes.map((code) =>
          declaration({ code, message_key: `app-detail.issue.${code}` })
        ),
      ),
    }),
  );
  assertEquals(
    paths.filter((path) => path.kind === "failure_path").map((path) =>
      path.code
    ),
    codes,
  );
  for (const code of codes) {
    assertEquals(required(paths, "failure_path", code).status, "required");
  }
});

Deno.test("problems/problem-codes#R8: 화면이 있으면 view 예외·feedback 경로가 필수다", () => {
  const paths = requiredReportPaths(bundle());
  assertEquals(
    required(paths, "view_exception", "_exception").status,
    "required",
  );
  assertEquals(required(paths, "feedback", "_feedback").status, "required");
  assertEquals(paths.length, 5);
});

Deno.test("problems/problem-codes#R8: 화면이 없으면 마지막 두 경로를 이유 있는 not_applicable로 남긴다", () => {
  const paths = requiredReportPaths(bundle({ has_view: false }));
  for (
    const kind of ["view_exception", "feedback"] as const
  ) {
    const path = required(
      paths,
      kind,
      kind === "feedback" ? "_feedback" : "_exception",
    );
    assertEquals(path.status, "not_applicable");
    assert(/./.test(path.reason.trim()), "reason must not be blank");
  }
  assertEquals(paths.length, 5);
  assertEquals(
    required(paths, "process_exception", "_exception").status,
    "required",
  );
  assertEquals(required(paths, "redaction", null).status, "required");
});

Deno.test("problems/problem-codes#R1: 순수 함수는 입력을 mutate하지 않는다", () => {
  const value: unknown = [declaration({ code: "a".repeat(48) })];
  const snapshot = JSON.stringify(value);
  const accepted1 = accepted(value);
  accepted1[0].message = "changed";
  assertEquals(JSON.stringify(value), snapshot);
  const previous = accepted([declaration()]);
  const current = accepted([declaration({ message: "Sign in again." })]);
  const previousSnapshot = JSON.stringify(previous);
  const currentSnapshot = JSON.stringify(current);
  const catalogSnapshot = JSON.stringify(RESERVED_PROBLEM_CODES);
  observeMeaningChanges(previous, current);
  requiredReportPaths(bundle({ problem_codes: current }));
  // 반환된 선언과 예약 항목을 실제로 바꿔도 원 입력·catalog·다음 호출이 그대로여야 한다.
  const reportable = reportableProblemCodes(
    current,
  ) as ProblemCodeDeclaration[];
  reportable[0].message = "changed";
  reportable.at(-1)!.message = "changed";
  const returned = reservedProblemCodes() as ProblemCodeDeclaration[];
  returned[0].message = "changed";
  assertEquals(JSON.stringify(previous), previousSnapshot);
  assertEquals(JSON.stringify(current), currentSnapshot);
  assertEquals(JSON.stringify(RESERVED_PROBLEM_CODES), catalogSnapshot);
  assertEquals(reservedProblemCodes(), [...RESERVED_PROBLEM_CODES]);
  assertEquals(
    reportableProblemCodes(current).map((entry) => entry.code),
    current.map((entry) => entry.code).concat([
      "_exception",
      "_feedback",
      "_invalid_report",
    ]),
  );
});
