// 앱 DB schema 규칙. IO 없음.
// schema 번호는 0부터 허용하고 DB 미사용 앱은 초기 migration을 요구하지 않는다.
// 공개한 migration은 새 파일로만 추가하며 내용을 고치지 않는다.

import { err, ok, type Result } from "../../../../base/mod.ts";
import type { DataChange } from "../../../../protocol/apps/mod.ts";

// 앱 DB가 자기 상태를 보관하는 표. schema 번호와 마지막 migration 결과만 담는다.
export const APP_SCHEMA_TABLE = "lophn_data_schema";

// 행은 항상 하나다. 단계마다 행을 쌓으면 첫 행이 옛 schema로 남는다.
export const APP_SCHEMA_SQL = [
  `create table if not exists ${APP_SCHEMA_TABLE} (`,
  "  id integer primary key check (id = 1),",
  "  data_schema integer not null check (data_schema >= 0),",
  "  last_result text not null check (last_result in ('applied', 'none')),",
  "  script_hash text,",
  "  applied_at text,",
  "  check (data_schema = 0 or script_hash is not null)",
  ")",
].join("\n");

// 마지막 migration 결과. "none"은 한 번도 migration을 적용하지 않은 schema 0이다.
export type SchemaState = {
  dataSchema: number;
  lastResult: "applied" | "none";
  scriptHash: string | null;
};

export const INITIAL_SCHEMA: SchemaState = {
  dataSchema: 0,
  lastResult: "none",
  scriptHash: null,
};

// 현재 schema에서 목표 schema까지의 연속 경로. 같은 release 안에서 분기·중복은 없다.
export type MigrationPath = {
  steps: readonly DataChange[];
};

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 공개한 migration을 바꾸려는 시도. 내용은 script_hash로만 비교한다.
export function migrationChanged(
  published: DataChange,
  candidate: DataChange,
): boolean {
  return published.from === candidate.from &&
    published.to === candidate.to &&
    published.script_hash !== candidate.script_hash;
}

// 현재 schema에서 목표까지의 연속 경로. 건너뛰기는 순서대로만 적용한다.
// 목표와 현재가 같으면 빈 경로다. DB 미사용(schema 0, 변경 없음)도 여기 해당한다.
export function migrationPath(
  current: number,
  target: number,
  changes: readonly DataChange[],
): Result<MigrationPath> {
  if (target < current) return invalid("data schema does not move backward");
  if (target === current) return ok({ steps: [] });
  const byFrom = new Map<number, DataChange>();
  for (const change of changes) {
    if (byFrom.has(change.from)) {
      return invalid("data change path branches");
    }
    byFrom.set(change.from, change);
  }
  const steps: DataChange[] = [];
  let cursor = current;
  while (cursor < target) {
    const step = byFrom.get(cursor);
    if (step === undefined || step.to > target) {
      return invalid("data change path is not continuous");
    }
    steps.push(step);
    cursor = step.to;
  }
  return ok({ steps });
}

// schema 통과는 업무 정확성이 아니다. 형태 검사와 업무 규칙 검사는 다른 결과다.
export type SchemaCheck = {
  schemaOk: boolean;
  businessCorrect: null;
};

export function schemaCheck(schemaOk: boolean): SchemaCheck {
  return { schemaOk, businessCorrect: null };
}
