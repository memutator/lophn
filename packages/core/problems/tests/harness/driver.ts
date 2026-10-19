import type { CheckDefinition } from "./definitions.ts";

// 앱이 바로 낸 ReadyAttestation의 test 자식 쪽 모양이다. `app_api`는 등록된 app-api key다.
export type Attestation = {
  bundle_hash: string;
  app_api: string[];
  data_schema: number;
  process_nonce: string;
};

export type MigrationScenario = "empty" | "upgrade";

// 고정 fixture DB에서 돌린 migration 한 번의 결과. 빈 DB 전체 migration은 schema 0에서,
// 이전 release schema는 이전 release의 schema에서 시작한다.
type MigrationRun = {
  ok: boolean;
  from_schema: number;
  data_schema: number;
  integrity_ok: boolean;
  // 중간 실패로 첫 변경 전 backup으로 되돌렸으면 true다.
  restored: boolean;
  reason: string;
};

// write app-api 하나를 fixture 입력으로 부르고 changeset을 뒤집어 적용한 결과다.
export type RewindRun = {
  // 호출이 성공했는지.
  called: boolean;
  // 호출이 DB 상태를 바꿨는지.
  changed: boolean;
  // 뒤집은 changeset이 적용됐는지.
  applied: boolean;
  // 적용 뒤 DB 상태가 호출 전과 같은지.
  restored: boolean;
  reason: string;
};

// 모은 changeset을 최신부터 뒤집어 한 번에 적용한 결과다. 비교 기준은 driver가 처음 앱을 부르기 전의 DB 상태다.
export type RestoreRun = {
  applied: boolean;
  restored: boolean;
  reason: string;
};

export type CallOutcome =
  // changeset은 base64다. write·external 호출이 DB를 바꿨을 때만 있다.
  | { status: "ok"; result: unknown; changeset?: string }
  | { status: "error"; code: string };

// ticket의 tool 예시 하나. 호출이 성공하면 그 result가 expect와 맞아야 한다.
export type HarnessExample = { tool: string; input?: unknown; expect: unknown };

// test 앱 자식을 실제 진입점으로 구동하는 쪽(runner)이 test 자식에 주는 통로다.
// harness는 앱 code를 import하지 않고 이 통로로만 만진다.
export type AppDriver = {
  probe(): Promise<Attestation>;
  // 선언한 입력 계약을 어긴 입력으로 app-api를 불러 입력 검증에서 거절됐는지 돌려준다.
  rejectsInvalidInput(tool: string): Promise<boolean>;
  // write app-api를 불러 changeset을 뒤집어 적용하고 DB 상태를 호출 전과 견준다.
  rewind(tool: string): Promise<RewindRun>;
  // app-api를 이 입력으로 불러 결과를 돌려준다. 앞선 호출이 만든 data는 뒤 호출에 보인다.
  call(tool: string, input: unknown): Promise<CallOutcome>;
  // call이 돌려준 changeset을 호출 순서대로 받아 최신부터 뒤집어 적용하고 첫 호출 전 DB 상태와 견준다.
  restore(changesets: readonly string[]): Promise<RestoreRun>;
  // 고정 fixture DB의 migration. 빈 DB 전체와 이전 release schema → 새 schema다.
  migrate(scenario: MigrationScenario): Promise<MigrationRun>;
};

export type HarnessPlanCheck = CheckDefinition & {
  digest: string;
  status: "required" | "not_applicable";
  reason: string;
};

// runner가 불변 설치 자료로 만들어 읽기 전용으로 건네는 검사 계획이다.
export type HarnessPlan = {
  bundle_hash: string;
  test_hash: string;
  // 선언한 app-api key.
  app_api: string[];
  // 그 가운데 write app-api key.
  write_api: string[];
  // 새 bundle의 data schema(0은 DB 미사용)와 이전 release의 schema.
  data: { schema: number; previous_schema: number | null };
  checks: HarnessPlanCheck[];
  // 예시 검증 실행의 예시. 아니면 빈 목록이다.
  examples: HarnessExample[];
};
