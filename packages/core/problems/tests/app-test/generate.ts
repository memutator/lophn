import type { Blueprint } from "../../../../protocol/apps/mod.ts";
import type {
  FrozenTest,
  ProblemCodeDeclaration,
} from "../../../../protocol/problems/mod.ts";
import {
  checkProblemCodeDeclarations,
  type MeaningChange,
  observeMeaningChanges,
  requiredReportPaths,
} from "../../problem-codes/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  type CheckCoverage,
  type CheckDefinition,
  checkDigest,
  coverageOf,
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
export type PlanCheck = HarnessPlanCheck & {
  precomputed: Precomputed | null;
  // 통과가 증명하는 고정 기준과 입력 범위(problems/tests#R12).
  coverage: CheckCoverage;
};

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
    | "problem_codes"
    | "commands"
    | "screens"
    | "sdk_dependencies"
    | "automatic_tasks"
    | "permissions"
    | "app_connections"
  >;
  // 새 bundle의 data schema(0은 DB 미사용)와 이전 release의 schema. 이전 release가
  // 없으면 previous_schema는 null이다(apps/data#R3).
  data: { schema: number; previous_schema: number | null };
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

function scopes(
  permissions: AppTestInput["blueprint"]["permissions"],
  kind: string,
): Record<string, unknown>[] {
  return permissions.filter((item) => item.kind === kind).map((item) =>
    item.scope as Record<string, unknown>
  );
}

function secretNames(
  permissions: AppTestInput["blueprint"]["permissions"],
): string[] {
  return scopes(permissions, "secret.use").map((scope) =>
    String(scope["name"])
  );
}

function externalEffects(blueprint: AppTestInput["blueprint"]): boolean {
  return blueprint.permissions.some((item) =>
    ["net.fetch", "secret.use", "document.save"].includes(item.kind)
  ) || blueprint.app_connections.length > 0 ||
    blueprint.commands.some((command) => command.effect === "external");
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
    coverage: coverageOf(definition),
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
  migration_empty: "빈 test DB에 전체 migration이 적용되는지",
  migration_upgrade: "이전 release schema에서 새 schema로 migration되는지",
  read_contract:
    "read command가 입력 계약을 지키고 업무·외부 상태를 바꾸지 않는지",
  automation_scope: "automation이 선언한 범위와 승인 규칙 안에서만 실행되는지",
  secret_grant: "grant된 secret의 가져오기·쓰기·동기화가 대역에서 허용되는지",
  adapter_isolation: "net·secret·문서 쓰기가 고정 대역에만 닿는지",
  revert_restore: "변경 → 되돌림 뒤 원래 업무 상태로 돌아오는지",
  revert_conflict: "후속 변경 뒤의 되돌림이 conflict로 거절되는지",
  revert_duplicate: "중복 되돌림이 거절되는지",
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
  // 앱 계약 검사는 blueprint가 선언한 기능마다 필수다. 선언이 없는 기능의 검사만
  // 이유 있는 not_applicable이다(problems/tests#R8, R9, R15; apps/blueprint#R21).
  const commands = input.blueprint.commands;
  const secrets = secretNames(input.blueprint.permissions);
  const contract = (
    name: HarnessCheckName,
    applies: boolean,
    reason: string,
  ) =>
    checks.push(
      planCheck(
        platformDefinition(name),
        applies ? "required" : "not_applicable",
        applies ? HARNESS_REASONS[name] : reason,
        null,
      ),
    );
  const usesData = input.data.schema > 0;
  contract("migration_empty", usesData, "DB를 쓰지 않는 앱(schema 0)이다");
  contract(
    "migration_upgrade",
    usesData && input.data.previous_schema !== null,
    usesData
      ? "이전 release가 없어 이전 schema가 없다"
      : "DB를 쓰지 않는 앱(schema 0)이다",
  );
  contract(
    "read_contract",
    commands.some((command) => command.effect === "read"),
    "read command가 선언되지 않았다",
  );
  contract(
    "automation_scope",
    input.blueprint.automatic_tasks.length > 0 ||
      commands.some((command) => command.confirm),
    "automation과 confirm command가 선언되지 않았다",
  );
  contract("secret_grant", secrets.length > 0, "secret.use가 선언되지 않았다");
  contract(
    "adapter_isolation",
    externalEffects(input.blueprint),
    "외부에 닿는 기능이 선언되지 않았다",
  );
  const revertable = commands.some((command) =>
    command.effect === "write" && command.revert.supported
  );
  for (
    const name of [
      "revert_restore",
      "revert_conflict",
      "revert_duplicate",
    ] as const
  ) {
    contract(name, revertable, "되돌리기를 지원하는 write command가 없다");
  }
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
    command_details: commands.map((command) => ({
      key: command.key,
      effect: command.effect,
      confirm: command.confirm,
      revert: command.revert,
    })),
    automations: input.blueprint.automatic_tasks.map((task) => ({
      key: task.key,
      command: task.command,
    })),
    secrets,
    net: scopes(input.blueprint.permissions, "net.fetch").map((scope) => ({
      host: String(scope["host"]),
      port: Number(scope["port"]),
    })),
    documents: scopes(input.blueprint.permissions, "document.save").map((
      scope,
    ) => String(scope["key"])),
    data: input.data,
    checks: checks.filter((check) => check.source === "harness").map((
      { precomputed: _precomputed, coverage: _coverage, ...rest },
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
