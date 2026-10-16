import { canonicalHash } from "../canonical.ts";
import {
  type CheckCoverage,
  type CheckDefinition,
  checkDigest,
  type CheckName,
  coverageOf,
  definitionOf,
} from "../harness/definitions.ts";
import type { HarnessPlan, HarnessPlanCheck } from "../harness/driver.ts";

export type Precomputed = {
  status: "pass" | "fail" | "inconclusive";
  reason: string;
  evidence: Record<string, unknown>;
};

// runner가 설치 자료로 만든 검사 하나. precomputed는 runner가 blueprint와 bundle 파일만으로
// 판정하는 검사의 결과이고, 나머지는 test 자식의 관측 frame으로 판정한다.
export type PlanCheck = HarnessPlanCheck & {
  precomputed: Precomputed | null;
  // 통과가 증명하는 고정 기준과 입력 범위.
  coverage: CheckCoverage;
};

export type AppTestPlan = {
  checks: PlanCheck[];
  // 설치 자료가 낸 검사 목록의 hash. 같은 blueprint는 같은 hash다.
  platform_hash: string;
  harness: HarnessPlan;
};

export type BundleDependency = {
  name: string;
  version: string;
  source: "sdk" | "package" | "npm" | "jsr";
};

export type AppTestInput = {
  bundle_hash: string;
  test_hash: string;
  app_api: readonly { key: string; effect: "read" | "write" | "external" }[];
  // 새 bundle의 data schema(0은 DB 미사용)와 이전 release의 schema. 이전 release가
  // 없으면 previous_schema는 null이다.
  data: { schema: number; previous_schema: number | null };
  // bundle manifest의 의존 목록과 bundle import map(specifier → 값).
  dependencies: readonly BundleDependency[];
  imports: Readonly<Record<string, string>>;
  // FrozenTest.sdk_dependencies. 의존 목록의 hash와 같아야 한다.
  frozen: { sdk_dependencies: string };
};

export function dependenciesHash(
  dependencies: readonly BundleDependency[],
): string {
  return canonicalHash(
    [...dependencies].map(({ name, version, source }) => ({
      name,
      version,
      source,
    })).sort((a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    ),
  );
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
    coverage: coverageOf(definition.name),
  };
}

const REASONS: Record<CheckName, string> = {
  blueprint_handler_match:
    "선언한 app-api와 실제 등록 handler가 일치하고 잘못된 입력이 거절되는지",
  dependencies: "bundle의 import가 선언한 의존을 정확한 version으로 가리키는지",
  migration_empty: "빈 test DB에 전체 migration이 적용되는지",
  migration_upgrade: "이전 release schema에서 새 schema로 migration되는지",
  rewind:
    "write app-api를 부른 뒤 changeset을 뒤집어 적용하면 원래 상태로 돌아오는지",
};

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const REGISTRY_IMPORT = /^(npm|jsr):(@[^/@]+\/[^/@]+|[^/@]+)@([^/]+)/;
const SDK_COPY = /^\.\/sdk\/([^/]+)\/([^/]+)\//;

// 선언한 의존과 bundle의 import가 같고 version이 정확한지 본다. 앱 안 상대 경로와 플랫폼이
// 놓은 file: 경로는 의존이 아니다.
function checkDependencies(input: AppTestInput): Precomputed {
  const inexact = input.dependencies.filter((item) =>
    !EXACT_VERSION.test(item.version)
  ).map((item) => `${item.name}@${item.version}`);
  const undeclared: string[] = [];
  for (const [specifier, value] of Object.entries(input.imports)) {
    if (value.startsWith("file:") || /^\.\.?\//.test(value)) {
      const copy = SDK_COPY.exec(value);
      if (copy === null) continue;
      const found = input.dependencies.some((item) =>
        item.name.split("/").pop() === copy[1] && item.version === copy[2]
      );
      if (!found) undeclared.push(specifier);
      continue;
    }
    const registry = REGISTRY_IMPORT.exec(value);
    const found = registry !== null &&
      input.dependencies.some((item) =>
        item.source === registry[1] && item.name === registry[2] &&
        item.version === registry[3]
      );
    if (!found) undeclared.push(specifier);
  }
  const evidence = {
    dependencies: input.dependencies.length,
    imports: Object.keys(input.imports).length,
    undeclared,
    inexact,
  };
  if (input.frozen.sdk_dependencies !== dependenciesHash(input.dependencies)) {
    return {
      status: "fail",
      reason: "의존 hash가 test가 고정한 값과 다르다",
      evidence,
    };
  }
  if (inexact.length > 0) {
    return {
      status: "fail",
      reason: "정확한 version이 아닌 의존이 있다",
      evidence,
    };
  }
  if (undeclared.length > 0) {
    return {
      status: "fail",
      reason: "선언하지 않은 의존을 import한다",
      evidence,
    };
  }
  return {
    status: "pass",
    reason: "import는 모두 선언한 의존을 정확한 version으로 가리킨다",
    evidence,
  };
}

// 필수 검사를 만든다. 검사 목록은 runner의 불변 설치 자료와 bundle에서만 나온다.
// bundle 안의 파일은 검사를 더하거나 빼거나 고칠 수 없다.
export function generateAppTestChecks(input: AppTestInput): AppTestPlan {
  const checks: PlanCheck[] = [];
  const add = (
    name: CheckName,
    applies: boolean,
    notApplicable: string,
    precomputed: Precomputed | null,
  ) =>
    checks.push(planCheck(
      definitionOf(name),
      applies ? "required" : "not_applicable",
      applies ? REASONS[name] : notApplicable,
      applies ? precomputed : null,
    ));

  add("blueprint_handler_match", true, "", null);
  add("dependencies", true, "", checkDependencies(input));
  const usesData = input.data.schema > 0;
  add("migration_empty", usesData, "DB를 쓰지 않는 앱(schema 0)이다", null);
  add(
    "migration_upgrade",
    usesData && input.data.previous_schema !== null,
    usesData
      ? "이전 release가 없어 이전 schema가 없다"
      : "DB를 쓰지 않는 앱(schema 0)이다",
    null,
  );
  const writes = input.app_api.filter((api) => api.effect === "write").map((
    api,
  ) => api.key);
  add("rewind", writes.length > 0, "write app-api가 선언되지 않았다", null);

  const harness: HarnessPlan = {
    bundle_hash: input.bundle_hash,
    test_hash: input.test_hash,
    app_api: input.app_api.map((api) => api.key),
    write_api: writes,
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
    harness,
  };
}
