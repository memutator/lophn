// 판 check runner의 입력과 출력. 규칙의 뜻은 docs/domain-model/documents/contexts.md의
// "ContextCheck"와 "격리 검사", 요구는 documents/contexts#R20이다.
import type { CheckFinding } from "../../../../protocol/projects/mod.ts";
import type { RuleViolation } from "../checks/types.ts";
import type {
  AppDataReader,
  ExtractViolation,
  ProjectFiles,
} from "../extract/types.ts";
import type { ValidationEnv } from "../validate/mod.ts";

export type CheckInput = {
  // submit한 판의 content JSON 그대로. 모양 검사(`bundleContentSchema`)는 runCheck 안에서 한다.
  bundle: unknown;
  // 검사 동안 쓰는 읽기 전용 snapshot. 시각·디스크·난수는 읽지 않는다.
  files: ProjectFiles;
  appData: AppDataReader;
  // 같은 project의 다른 context가 내놓은 type과 앱 명령의 effect
  env: ValidationEnv;
  // 사람이 저장해 둔 saved view(ledger 행). 판에 든 saved view와 함께 모두 불러 본다.
  user_saved_views: readonly {
    name: string;
    search: string;
    inputs: Record<string, unknown>;
  }[];
};

// 기록하는 위반 하나: extract가 낸 것과 규칙이 낸 것.
export type CheckViolation = ExtractViolation | RuleViolation;

// CheckReport의 끝난 부분(status, snapshot_hash, findings, violation_count)과 위반 자체.
// id, 시각, bundle은 command 쪽이 채운다.
export type CheckOutcome = {
  status: "passed" | "failed";
  // snapshotHash(files). 모양이 틀린 판이어도 항상 있다.
  snapshot_hash: string;
  // passed면 []. failed면 1개 이상이고 아래 순서다.
  findings: CheckFinding[];
  // violations.length. 통과 여부와 상관없이 센다.
  violation_count: number;
  // path, kind, rule(extract 위반은 null을 ""로 본다), section(null이 먼저)의 code unit 순.
  // 모양·의미 검사에서 멈추면 [].
  violations: CheckViolation[];
};

// ---------- finding ----------
//
// 단계 순서로 멈춘다. 앞 단계가 실패하면 뒤 단계는 돌지 않는다(계약이 깨졌으면 뒤 결과가 뜻이 없다).
//
// 1. 모양: `bundleContentSchema` 실패. zod issue마다 finding 하나, issue의 path 순.
//    kind `contract_invalid`, 메시지가 "expected root-relative path"인 issue는 `cross_project_path`.
//    target은 path를 "."로 이은 것(`contract.types.0.source.pattern`), 비면 null. detail은 issue message.
// 2. 의미: `validateBundle` issue마다 finding 하나, issue 순서 그대로(이미 정렬됨).
//    kind `contract_invalid`, code가 `relation_target_private`·`search_path_private`이면 `private_reference`.
//    target은 issue path를 "."로 이은 것, detail은 issue code.
// 3. 추출: `extractAll`이 throw하면 `aborted` 하나(target null, detail은 오류 message). 여기서 멈춘다.
// 4. 예: `examples` 순서대로 맞지 않는 것마다 `example_mismatch`. target은 `examples.<번호>`,
//    detail은 아래 EXAMPLE_REASONS 중 하나로 시작하는 글.
// 5. saved view: `saved_views` 순서대로 `runSearch`가 오류를 내는 것마다 `saved_view_broken`.
//    target은 `saved_views.<이름>`, detail은 `<오류 code>`(입력 이름이 있으면 `<code>: <입력>`).
//
// 검색 예의 key 목록은 table이면 행 순서, board면 칸 순서대로 칸마다 행 순서를 이은 것이다(첫 page만).
// 4와 5는 서로 막지 않는다. 위반(extract·rule)은 finding이 아니다.
export const EXAMPLE_REASONS = [
  "entity_not_found", // 그 path(+section)에 그 type·key의 개체가 없다
  "field_differs", // 개체는 있으나 expect.fields의 값이 다르다
  "search_error", // runSearch가 오류를 냈다
  "keys_differ", // runSearch의 key 목록이 expect_keys와 다르다
] as const;
export type ExampleReason = typeof EXAMPLE_REASONS[number];
