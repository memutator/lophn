// 모양·의미 검사 결과를 CheckFinding으로 옮긴다. 규칙은 types.ts의 "finding"이다.
import type { CheckFinding } from "../../../../protocol/projects/mod.ts";
import type { ContractIssue } from "../validate/mod.ts";

const PRIVATE_CODES: readonly string[] = [
  "relation_target_private",
  "search_path_private",
];

// zod issue 중 이 검사가 쓰는 부분.
type SchemaIssue = {
  path: readonly PropertyKey[];
  message: string;
};

const targetOf = (path: readonly PropertyKey[]): string | null =>
  path.length === 0 ? null : path.map(String).join(".");

export function schemaFindings(issues: readonly SchemaIssue[]): CheckFinding[] {
  return issues.map((issue) => ({
    kind: issue.message === "expected root-relative path"
      ? "cross_project_path"
      : "contract_invalid",
    target: targetOf(issue.path),
    detail: issue.message,
  }));
}

export function meaningFindings(
  issues: readonly ContractIssue[],
): CheckFinding[] {
  return issues.map((issue) => ({
    kind: PRIVATE_CODES.includes(issue.code)
      ? "private_reference"
      : "contract_invalid",
    target: targetOf(issue.path),
    detail: issue.code,
  }));
}
