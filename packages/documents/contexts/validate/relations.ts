// 계약 의미 검사: 관계 대상(같은 계약 또는 다른 context의 public type), via field와 다중도, 관계 visibility, relation_target_exists rule.
import { splitExternalRef } from "../../../contracts/documents/mod.ts";
import type { ContractCheck, ContractIssue } from "./types.ts";

export const checkRelations: ContractCheck = (bundle, env) => {
  const issues: ContractIssue[] = [];
  const types = bundle.contract.types;
  const own = new Set(types.map((type) => type.name));

  types.forEach((type, t) => {
    type.relations.forEach((relation, r) => {
      const at = (key: string) =>
        ["contract", "types", t, "relations", r, key] as (string | number)[];

      const ref = splitExternalRef(relation.to);
      if (ref === undefined) {
        if (!own.has(relation.to)) {
          issues.push({ code: "relation_target_unknown", path: at("to") });
        }
      } else {
        const external = env.externalTypes.find((candidate) =>
          candidate.context === ref.context && candidate.name === ref.type
        );
        if (external === undefined) {
          issues.push({ code: "relation_target_unknown", path: at("to") });
        } else if (external.visibility === "private") {
          issues.push({ code: "relation_target_private", path: at("to") });
        }
      }

      const via = type.fields.find((field) => field.name === relation.via);
      if (via === undefined) {
        issues.push({ code: "relation_via_unknown", path: at("via") });
      } else if (
        (relation.cardinality === "many") !== (via.value_type === "list")
      ) {
        issues.push({ code: "relation_via_mismatch", path: at("cardinality") });
      }

      if (relation.visibility === "public" && type.visibility === "private") {
        issues.push({
          code: "relation_visibility_wider_than_type",
          path: at("visibility"),
        });
      }
    });

    type.rules.forEach((rule, i) => {
      if (
        rule.kind === "relation_target_exists" &&
        !type.relations.some((relation) =>
          relation.name === rule.params.relation
        )
      ) {
        issues.push({
          code: "rule_relation_unknown",
          path: ["contract", "types", t, "rules", i, "params", "relation"],
        });
      }
    });
  });

  return issues;
};
