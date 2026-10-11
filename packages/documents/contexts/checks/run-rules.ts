import type {
  CheckRule,
  ContractType,
} from "../../../contracts/documents/mod.ts";
import type {
  CheckEntity,
  CheckFieldValue,
  ExternalKeys,
  RuleViolation,
} from "./types.ts";

// 한 type의 개체(입력 순서)에 규칙 하나를 적용해 위반을 낸다. 입력은 바꾸지 않는다.
export interface RuleScope {
  readonly type: ContractType;
  readonly entities: readonly CheckEntity[];
  readonly allEntities: readonly CheckEntity[];
  readonly externalKeys: ExternalKeys;
}

const violationOf = (
  type: ContractType,
  rule: CheckRule,
  entity: CheckEntity,
  target: string | null = null,
): RuleViolation => ({
  kind: "rule",
  rule: `${type.name}.${rule.id}`,
  type: type.name,
  path: entity.path,
  section: entity.section,
  target,
});

// 값이 없으면(null, 빠짐) 빈 목록, 있으면 항목 목록(scalar는 항목 하나)
function itemsOf(
  value: CheckFieldValue | undefined,
): (string | number | boolean)[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value)
    ? [...value]
    : [value as string | number | boolean];
}

export function applyRule(rule: CheckRule, scope: RuleScope): RuleViolation[] {
  const { type, entities } = scope;
  const at = (entity: CheckEntity, target: string | null = null) =>
    violationOf(type, rule, entity, target);
  switch (rule.kind) {
    case "required_field": {
      const name = rule.params.field;
      return entities.filter((e) => (e.fields[name] ?? null) === null).map((
        e,
      ) => at(e));
    }
    case "unique_key": {
      const names = rule.params.fields;
      const seen = new Set<string>();
      const out: RuleViolation[] = [];
      for (const e of entities) {
        let id: string;
        if (names === undefined) {
          id = e.key;
        } else {
          const values = names.map((n) => e.fields[n] ?? null);
          if (values.some((v) => v === null)) continue;
          id = JSON.stringify(values);
        }
        if (seen.has(id)) out.push(at(e));
        else seen.add(id);
      }
      return out;
    }
    case "relation_target_exists": {
      const relation = type.relations.find((r) =>
        r.name === rule.params.relation
      );
      if (relation === undefined) return [];
      const slash = relation.to.indexOf("/");
      let keys: ReadonlySet<string> | undefined;
      if (slash >= 0) {
        keys = scope.externalKeys(
          relation.to.slice(0, slash),
          relation.to.slice(slash + 1),
        );
      } else {
        keys = new Set(
          scope.allEntities.filter((e) => e.type === relation.to).map((e) =>
            e.key
          ),
        );
      }
      if (keys === undefined) return [];
      const known = keys;
      return entities.flatMap((e) =>
        e.links.filter((l) =>
          l.relation === relation.name && !known.has(l.target_key)
        ).map((l) => at(e, l.target_key))
      );
    }
    case "enum_value": {
      const field = type.fields.find((f) => f.name === rule.params.field);
      const allowed = field?.values;
      if (allowed === undefined) return [];
      return entities.filter((e) =>
        itemsOf(e.fields[rule.params.field]).some((v) =>
          !allowed.includes(String(v))
        )
      ).map((e) => at(e));
    }
    case "pattern": {
      const regex = new RegExp(rule.params.regex, "u");
      return entities.filter((e) =>
        itemsOf(e.fields[rule.params.field]).some((v) => !regex.test(String(v)))
      ).map((e) => at(e));
    }
    case "count_range": {
      const { field, min, max } = rule.params;
      const outside = (n: number) =>
        (min !== undefined && n < min) || (max !== undefined && n > max);
      if (field === undefined) {
        return entities.length > 0 && outside(entities.length)
          ? [at(entities[0])]
          : [];
      }
      return entities.filter((e) => outside(itemsOf(e.fields[field]).length))
        .map((e) => at(e));
    }
  }
}
