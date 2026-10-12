import type { BundleContent } from "../../../../protocol/projects/mod.ts";
import { checkFields } from "./fields.ts";
import { checkRelations } from "./relations.ts";
import { checkSearches } from "./searches.ts";
import { checkSources } from "./sources.ts";
import { type ContractIssue, sortIssues, type ValidationEnv } from "./types.ts";

export {
  type AppCommandEffect,
  CONTRACT_ISSUE_CODES,
  type ContractIssue,
  type ContractIssueCode,
  type ExternalType,
  sortIssues,
  type ValidationEnv,
} from "./types.ts";

// 모양이 맞는 묶음의 의미 검사. 빈 목록이면 통과다.
export function validateBundle(
  bundle: BundleContent,
  env: ValidationEnv,
): ContractIssue[] {
  return sortIssues([
    ...checkSources(bundle, env),
    ...checkFields(bundle, env),
    ...checkRelations(bundle, env),
    ...checkSearches(bundle, env),
  ]);
}
