// 계약 묶음의 의미 검사. 모양은 contracts의 bundleContentSchema가 먼저 본다.
// 네 검사(sources, fields, relations, searches)는 서로 다른 파일이고 같은 입력·출력 모양을 쓴다.
import type {
  BundleContent,
  ContractVisibility,
} from "../../../../protocol/projects/mod.ts";

export const CONTRACT_ISSUE_CODES = [
  // sources
  "series_pattern_invalid",
  "series_pattern_overlap",
  "from_type_unknown",
  "from_type_self",
  "index_not_markdown",
  "app_command_unknown",
  "app_command_not_read",
  // fields
  "key_field_missing",
  "key_field_not_scalar",
  "field_from_not_allowed",
  "path_capture_unknown",
  "yaml_file_required",
  "links_type_unknown",
  "field_visibility_wider_than_type",
  "rule_field_unknown",
  "rule_field_not_enum",
  "rule_field_not_list",
  // relations
  "relation_target_unknown",
  "relation_target_private",
  "relation_via_unknown",
  "relation_via_mismatch",
  "relation_visibility_wider_than_type",
  "rule_relation_unknown",
  // searches, examples, saved views
  "search_from_unknown",
  "search_follow_from_unknown",
  "search_follow_relation_unknown",
  "search_path_unknown",
  "search_path_private",
  "search_input_unknown",
  "search_input_of_unknown",
  "search_input_of_not_range",
  "example_search_unknown",
  "example_type_unknown",
  "example_input_unknown",
  "example_input_required",
  "saved_view_search_unknown",
  "saved_view_input_unknown",
  "saved_view_input_required",
] as const;
export type ContractIssueCode = typeof CONTRACT_ISSUE_CODES[number];

// path는 BundleContent JSON 안의 위치다(예: ["contract", "types", 0, "source", "pattern"]).
export type ContractIssue = {
  code: ContractIssueCode;
  path: (string | number)[];
};

// 같은 project의 다른 context가 내놓은 type. 관계와 검색은 visibility가 public인 것만 쓸 수 있다.
export type ExternalType = {
  context: string;
  name: string;
  visibility: ContractVisibility;
  key: string;
  fields: readonly {
    name: string;
    visibility: ContractVisibility;
    value_type: string;
  }[];
};

export type AppCommandEffect = "read" | "write" | "external" | "unknown";

export type ValidationEnv = {
  externalTypes: readonly ExternalType[];
  appCommandEffect(app: string, command: string): AppCommandEffect;
};

export type ContractCheck = (
  bundle: BundleContent,
  env: ValidationEnv,
) => ContractIssue[];

// 검사 결과의 순서: path를 이은 문자열의 code unit 순, 같으면 code 순. locale을 쓰지 않는다.
export function sortIssues(issues: readonly ContractIssue[]): ContractIssue[] {
  const key = (issue: ContractIssue) => issue.path.join("\u0000");
  return [...issues].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}
