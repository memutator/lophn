// 계약 의미 검사: key field, source kind별로 허용되는 field 출처, path capture 이름, yaml file, links 대상, field visibility, field를 가리키는 rule.
import type {
  BundleContent,
  CheckRule,
  ContractField,
  ContractType,
} from "../../../../protocol/projects/mod.ts";
import { fromAllowed, pathCaptures } from "./fields-from.ts";
import type {
  ContractCheck,
  ContractIssue,
  ContractIssueCode,
} from "./types.ts";

type Path = ContractIssue["path"];

const issue = (code: ContractIssueCode, path: Path): ContractIssue => ({
  code,
  path,
});

export const checkFields: ContractCheck = (bundle: BundleContent) => {
  const typeNames = new Set(bundle.contract.types.map((type) => type.name));
  return bundle.contract.types.flatMap((type, t) =>
    checkType(type, ["contract", "types", t], typeNames)
  );
};

function checkType(
  type: ContractType,
  at: Path,
  typeNames: ReadonlySet<string>,
): ContractIssue[] {
  return [
    ...checkKey(type, at),
    ...type.fields.flatMap((field, f) =>
      checkField(type, field, [...at, "fields", f], typeNames)
    ),
    ...type.rules.flatMap((rule, r) =>
      checkRule(type, rule, [...at, "rules", r])
    ),
  ];
}

function checkKey(type: ContractType, at: Path): ContractIssue[] {
  const key = findField(type, type.key);
  if (key === undefined) return [issue("key_field_missing", [...at, "key"])];
  if (key.value_type === "list") {
    return [issue("key_field_not_scalar", [...at, "key"])];
  }
  return [];
}

function checkField(
  type: ContractType,
  field: ContractField,
  at: Path,
  typeNames: ReadonlySet<string>,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const from = field.from;
  const fromPath = [...at, "from"];
  if (!fromAllowed(type.source, from)) {
    issues.push(issue("field_from_not_allowed", fromPath));
  } else if (
    from.kind === "yaml" && type.source.kind === "folder" &&
    from.file === undefined
  ) {
    issues.push(issue("yaml_file_required", fromPath));
  } else if (
    from.kind === "path" && !pathCaptures(type.source).includes(from.capture)
  ) {
    issues.push(issue("path_capture_unknown", [...fromPath, "capture"]));
  }
  // links 대상은 출처와 따로 본다. 대상 이름이 틀린 것은 출처가 무엇이든 틀린 것이다.
  if (
    from.kind === "links" && from.to_type !== undefined &&
    !typeNames.has(from.to_type)
  ) {
    issues.push(issue("links_type_unknown", [...fromPath, "to_type"]));
  }
  if (type.visibility === "private" && field.visibility === "public") {
    issues.push(
      issue("field_visibility_wider_than_type", [...at, "visibility"]),
    );
  }
  return issues;
}

function checkRule(
  type: ContractType,
  rule: CheckRule,
  at: Path,
): ContractIssue[] {
  const params = [...at, "params"];
  switch (rule.kind) {
    case "required_field":
    case "pattern":
      return unknownRuleField(type, rule.params.field, [...params, "field"]);
    case "enum_value": {
      const path = [...params, "field"];
      const target = findField(type, rule.params.field);
      if (target === undefined) return [issue("rule_field_unknown", path)];
      // enum field와 enum 목록 field(항목마다 검사)만 받는다.
      return target.value_type === "enum" ||
          (target.value_type === "list" && target.item_type === "enum")
        ? []
        : [issue("rule_field_not_enum", path)];
    }
    case "count_range": {
      if (rule.params.field === undefined) return [];
      const path = [...params, "field"];
      const target = findField(type, rule.params.field);
      if (target === undefined) return [issue("rule_field_unknown", path)];
      return target.value_type === "list"
        ? []
        : [issue("rule_field_not_list", path)];
    }
    case "unique_key":
      return (rule.params.fields ?? []).flatMap((name, i) =>
        unknownRuleField(type, name, [...params, "fields", i])
      );
    // relation_target_exists의 params.relation은 relations 검사의 몫이다.
    case "relation_target_exists":
      return [];
  }
}

function unknownRuleField(
  type: ContractType,
  name: string,
  path: Path,
): ContractIssue[] {
  return findField(type, name) === undefined
    ? [issue("rule_field_unknown", path)]
    : [];
}

function findField(
  type: ContractType,
  name: string,
): ContractField | undefined {
  return type.fields.find((field) => field.name === name);
}
