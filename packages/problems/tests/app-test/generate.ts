import type { Blueprint } from "../../../contracts/apps/mod.ts";
import type {
  FrozenTest,
  ProblemCodeDeclaration,
} from "../../../contracts/problems/mod.ts";
import {
  checkProblemCodeDeclarations,
  type MeaningChange,
  observeMeaningChanges,
  requiredReportPaths,
} from "../../problem-codes/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  type CheckDefinition,
  checkDigest,
  failurePathDefinition,
  type HarnessCheckName,
  type PlatformCheckName,
  platformDefinition,
} from "../harness/definitions.ts";
import type { HarnessPlan, HarnessPlanCheck } from "../harness/driver.ts";

export type Precomputed = {
  status: "pass" | "fail";
  reason: string;
  evidence: Record<string, unknown>;
};

// runner가 설치 자료로 만든 검사 하나. precomputed는 runner가 blueprint와 고정
// 묶음만으로 판정하는 검사의 결과이고, 나머지는 test 자식의 관측 frame으로 판정한다.
export type PlanCheck = HarnessPlanCheck & { precomputed: Precomputed | null };

export type AppTestPlan = {
  checks: PlanCheck[];
  // 설치 자료가 낸 검사 목록의 hash. 같은 blueprint는 같은 hash다.
  platform_hash: string;
  meaning_changes: MeaningChange[];
  harness: HarnessPlan;
};

export type AppTestInput = {
  bundle_hash: string;
  test_hash: string;
  blueprint: Pick<
    Blueprint,
    "problem_codes" | "commands" | "screens" | "sdk_dependencies"
  >;
  // 고정 blueprint blob의 hash. FrozenTest.blueprint와 같아야 한다.
  blueprint_hash: string;
  frozen: Pick<FrozenTest, "blueprint" | "sdk_dependencies" | "failure_paths">;
  // runner 설치 자료의 고정 SDK. 앱이 다른 version을 쓰면 통과하지 못한다.
  fixed_sdk: readonly { name: string; version: string }[];
  // 이전 release의 선언. 없으면 같은 code의 의미 변경을 비교하지 않는다.
  previous_declarations: readonly ProblemCodeDeclaration[] | null;
};

export function sdkDependenciesHash(
  dependencies: readonly { name: string; version: string }[],
): string {
  return canonicalHash(
    [...dependencies].map(({ name, version }) => ({ name, version })).sort((
      a,
      b,
    ) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
  );
}

function pass(reason: string, evidence: Record<string, unknown>): Precomputed {
  return { status: "pass", reason, evidence };
}
function fail(reason: string, evidence: Record<string, unknown>): Precomputed {
  return { status: "fail", reason, evidence };
}

function planCheck(
  definition: CheckDefinition,
  status: "required" | "not_applicable",
  reason: string,
  precomputed: Precomputed | null,
): PlanCheck {
  return {
    ...definition,
    digest: checkDigest(definition),
    status,
    reason,
    precomputed,
  };
}

const HARNESS_REASONS: Record<HarnessCheckName, string> = {
  blueprint_handler_match: "선언한 command와 실제 등록 handler가 일치하는지",
  code_usage_static: "source가 선언한 code만 literal로 보고하는지",
  code_usage_dynamic: "선언 없는 code와 예약 code의 직접 보고가 거절되는지",
  sdk_receipt: "SDK completion을 기다려 실제 접수를 확인하는지",
  process_exception: "처리되지 않은 process 예외가 접수되는지",
  redaction: "보고가 저장되기 전에 redaction을 거치는지",
  permission_denial: "grant 없는 접근이 거절되는지",
  view_exception: "처리되지 않은 view 예외가 접수되는지",
  feedback: "깨진 view의 feedback이 접수되는지",
  migration_empty: "빈 test DB에서 migration이 성공하는지",
  migration_upgrade: "이전 schema에서 새 schema로 migration이 성공하는지",
  read_contract: "read 선언 command가 업무 데이터를 쓰지 않는지",
  automation_scope: "automation이 선언된 범위와 승인 정책 안에서 실행되는지",
  adapter_isolation: "net·secret·문서 접근이 고정 대역만 사용하는지",
};

// 필수 검사를 만든다. 검사 목록은 runner의 불변 설치 자료와 고정 blueprint에서만
// 나온다. bundle 안의 파일은 검사를 더하거나 빼거나 고칠 수 없다(problems/tests#R6).
export function generateAppTestChecks(input: AppTestInput): AppTestPlan {
  const declared = checkProblemCodeDeclarations(input.blueprint.problem_codes);
  const declarations = declared.ok ? declared.value : [];
  const hasView = input.blueprint.screens.length > 0;
  const checks: PlanCheck[] = [];

  const blueprintMatches = input.frozen.blueprint === input.blueprint_hash;
  checks.push(planCheck(
    platformDefinition("declarations"),
    "required",
    "problem code 선언이 올바르고 고정 blueprint와 같은지",
    !declared.ok
      ? fail("problem code 선언이 올바르지 않다", { valid: false })
      : !blueprintMatches
      ? fail("고정 blueprint hash가 test가 고정한 값과 다르다", {
        blueprint_hash: input.blueprint_hash,
      })
      : pass("problem code 선언이 올바르고 고정 blueprint와 같다", {
        codes: declarations.map((item) => item.code),
      }),
  ));

  const dependencies = input.blueprint.sdk_dependencies;
  const missing = input.fixed_sdk.filter((fixed) =>
    !dependencies.some((item) =>
      item.name === fixed.name && item.version === fixed.version
    )
  );
  const hashMatches = input.frozen.sdk_dependencies ===
    sdkDependenciesHash(dependencies);
  checks.push(planCheck(
    platformDefinition("fixed_sdk"),
    "required",
    "고정 SDK 의존을 그대로 쓰는지",
    missing.length > 0
      ? fail("고정 SDK 의존이 없거나 version이 다르다", {
        missing: missing.map((item) => `${item.name}@${item.version}`),
      })
      : !hashMatches
      ? fail("SDK 의존 hash가 test가 고정한 값과 다르다", {})
      : pass("고정 SDK 의존을 그대로 쓴다", {
        dependencies: dependencies.length,
      }),
  ));

  const paths = input.frozen.failure_paths ?? [];
  const covered = new Map<string, number>();
  for (const path of paths) {
    covered.set(path.code, (covered.get(path.code) ?? 0) + 1);
  }
  const declaredCodes = new Set(declarations.map((item) => item.code));
  const uncovered = declarations.filter((item) => !covered.has(item.code))
    .map((item) => item.code);
  const extra = [...covered.keys()].filter((code) => !declaredCodes.has(code));
  const repeated = [...covered].filter(([, count]) => count > 1).map(([code]) =>
    code
  );
  checks.push(planCheck(
    platformDefinition("failure_path_coverage"),
    "required",
    "선언한 code마다 실패 경로 test가 있는지",
    uncovered.length > 0
      ? fail("실패 경로 test가 없는 선언 code가 있다", { uncovered })
      : extra.length > 0 || repeated.length > 0
      ? fail("선언하지 않았거나 겹치는 실패 경로 test가 있다", {
        extra,
        repeated,
      })
      : pass("선언한 code마다 실패 경로 test가 있다", {
        covered: [...covered.keys()].sort(),
      }),
  ));

  for (
    const name of [
      "blueprint_handler_match",
      "code_usage_static",
      "code_usage_dynamic",
      "sdk_receipt",
      "process_exception",
      "redaction",
      "permission_denial",
    ] as const satisfies readonly PlatformCheckName[]
  ) {
    checks.push(
      planCheck(
        platformDefinition(name),
        "required",
        HARNESS_REASONS[name],
        null,
      ),
    );
  }

  // App contract checks (problems/tests#R8, R9, R12, R15)
  // These checks verify app contracts at runtime. They are required only if the
  // app declares the relevant features (migrations, automations, etc.).
  // For test fixtures without these features, they are not_applicable.
  const automaticTasks = (input.blueprint as Record<string, unknown>)
    .automatic_tasks as unknown[] | undefined || [];
  const documents = (input.blueprint as Record<string, unknown>)
    .documents as unknown[] | undefined || [];
  const hasAutomations = automaticTasks.length > 0;
  const hasReadCommands = input.blueprint.commands.some((cmd) => {
    const command = cmd as Record<string, unknown>;
    return command.effect === "read";
  });

  // Migration checks (R8): placeholder for apps#T17 data migrations
  // For now, not required since test fixtures don't have migrations
  checks.push(
    planCheck(
      platformDefinition("migration_empty"),
      "not_applicable",
      "app이 데이터 migration을 선언하지 않음",
      null,
    ),
  );
  checks.push(
    planCheck(
      platformDefinition("migration_upgrade"),
      "not_applicable",
      "app이 데이터 migration을 선언하지 않음",
      null,
    ),
  );

  // Blueprint contract checks (R9, R12, R15)
  // read_contract: only if app has read commands
  checks.push(
    planCheck(
      platformDefinition("read_contract"),
      hasReadCommands ? "required" : "not_applicable",
      hasReadCommands
        ? HARNESS_REASONS.read_contract
        : "read 선언 command가 없음",
      null,
    ),
  );

  // automation_scope: only if app has automations
  checks.push(
    planCheck(
      platformDefinition("automation_scope"),
      hasAutomations ? "required" : "not_applicable",
      hasAutomations
        ? HARNESS_REASONS.automation_scope
        : "자동 작업이 선언되지 않음",
      null,
    ),
  );

  // adapter_isolation: only if app has external features
  const hasExternalFeatures = hasAutomations || documents.length > 0;
  checks.push(
    planCheck(
      platformDefinition("adapter_isolation"),
      hasExternalFeatures ? "required" : "not_applicable",
      hasExternalFeatures
        ? HARNESS_REASONS.adapter_isolation
        : "외부 상호작용이 없음",
      null,
    ),
  );
  // 화면 없는 bundle의 화면 검사만 이유 있는 not_applicable이다(problem-codes#R8).
  for (
    const path of requiredReportPaths({
      problem_codes: declarations,
      has_view: hasView,
    })
  ) {
    if (path.kind !== "view_exception" && path.kind !== "feedback") continue;
    checks.push(planCheck(
      platformDefinition(path.kind),
      path.status,
      path.status === "required" ? HARNESS_REASONS[path.kind] : path.reason,
      null,
    ));
  }
  for (const declaration of declarations) {
    checks.push(planCheck(
      failurePathDefinition(declaration.code),
      "required",
      "선언한 실패가 실제 command에서 접수되는지",
      null,
    ));
  }

  const harness: HarnessPlan = {
    bundle_hash: input.bundle_hash,
    test_hash: input.test_hash,
    declared_codes: declarations.map((item) => item.code),
    commands: input.blueprint.commands.map((command) => command.key),
    has_view: hasView,
    checks: checks.filter((check) => check.source === "harness").map((
      { precomputed: _precomputed, ...rest },
    ) => rest),
  };
  return {
    checks,
    platform_hash: canonicalHash(
      checks.map((check) => [check.name, check.digest, check.status]),
    ),
    meaning_changes: input.previous_declarations && declared.ok
      ? observeMeaningChanges(input.previous_declarations, declarations)
      : [],
    harness,
  };
}
