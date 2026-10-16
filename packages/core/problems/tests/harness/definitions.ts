import { createHash } from "node:crypto";
import { canonicalize } from "../../../../base/mod.ts";

// 앱 test의 필수 검사 정의. runner의 불변 설치 자료이고 앱 bundle이 고칠 수 없다.
// 검사마다 정의 digest가 있고 test 자식은 관측 frame의 actual에 그 digest를 실어 보낸다.
// runner가 설치 자료의 digest와 다르면 검사가 바뀐 것으로 본다.
export const CHECK_DEFINITIONS_VERSION = 1;

export const REQUIRED_CHECKS = [
  // 선언한 app-api와 앱이 등록한 handler가 같고, 선언한 입력 계약을 어긴 입력은 거절된다.
  "blueprint_handler_match",
  // 선언한 의존과 import가 같고 version이 정확하다.
  "dependencies",
  "migration_empty",
  "migration_upgrade",
  // write app-api를 부른 뒤 core가 그 invocation의 changeset을 뒤집어 적용하면 DB 상태가 부르기 전과 같다.
  "rewind",
] as const;
export type CheckName = (typeof REQUIRED_CHECKS)[number];

// runner가 blueprint와 bundle 파일만으로 판정하는 검사와, test 자식이 앱을 구동해 판정하는 검사.
type CheckSource = "runner" | "harness";

export type CheckDefinition = { name: CheckName; source: CheckSource };

const SOURCES: Record<CheckName, CheckSource> = {
  blueprint_handler_match: "harness",
  dependencies: "runner",
  migration_empty: "harness",
  migration_upgrade: "harness",
  rewind: "harness",
};

export function checkDigest(definition: CheckDefinition): string {
  return createHash("sha256").update(
    canonicalize({ version: CHECK_DEFINITIONS_VERSION, ...definition }),
    "utf8",
  ).digest("hex");
}

export function definitionOf(name: CheckName): CheckDefinition {
  return { name, source: SOURCES[name] };
}

// 통과가 증명하는 범위. 검사마다 고정 기준과 입력 범위를 runner의 설치 자료로 두고,
// observations는 이것을 인접 불변식과 따로 적는다.
export type CheckCoverage = { criteria: string[]; input_range: string };

const COVERAGE: Record<CheckName, CheckCoverage> = {
  blueprint_handler_match: {
    criteria: [
      "선언 app-api 집합과 등록 handler 집합이 같다",
      "입력 계약을 어긴 입력이 거절된다",
    ],
    input_range: "준비 attestation 한 번과 app-api마다 잘못된 입력 1개",
  },
  dependencies: {
    criteria: [
      "bundle의 import는 모두 선언한 의존을 가리킨다",
      "선언한 의존의 version이 정확하다",
    ],
    input_range: "bundle manifest의 의존 목록과 import map",
  },
  migration_empty: {
    criteria: [
      "빈 test DB(schema 0)에 전체 migration이 새 schema까지 적용된다",
      "적용 뒤 무결성 확인이 통과한다",
    ],
    input_range:
      "빈 fixture DB 1개. schema 번호와 무결성만 보고 업무 정확성은 증명하지 않는다",
  },
  migration_upgrade: {
    criteria: [
      "이전 release schema의 DB가 새 schema로 migration된다",
      "적용 뒤 무결성 확인이 통과하고 되돌림 없이 끝난다",
    ],
    input_range:
      "이전 release schema의 fixture DB 1개. 업무 정확성은 증명하지 않는다",
  },
  rewind: {
    criteria: [
      "write app-api를 부른 뒤 changeset을 뒤집어 적용하면 업무 상태가 부르기 전과 같다",
    ],
    input_range: "write app-api마다 호출 1회와 rewind 1회",
  },
};

export function coverageOf(name: CheckName): CheckCoverage {
  return COVERAGE[name];
}
