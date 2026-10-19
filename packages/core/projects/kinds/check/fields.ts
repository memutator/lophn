// item 전체를 보고 정해지는 칸 규칙: unique, ref, pattern, enum. message에 문서의 값을 싣지 않는다
// (칸 이름과 규칙만).
import type { Kind } from "../../../../protocol/projects/mod.ts";
import type { DocumentViolation, Item } from "../extract/items.ts";

const valuesOf = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === null || value === undefined
    ? []
    : [value];

// 같은 kind 안에서 유일해야 하는 칸: unique를 단 칸과 key 칸(ref가 key로 가리킨다). path는 늘 유일하다.
function uniqueFields(kind: Kind): string[] {
  const names = Object.entries(kind.fields).filter(([, field]) => field.unique)
    .map(([name]) => name);
  if (kind.key !== "path" && !names.includes(kind.key)) names.push(kind.key);
  return names;
}

export function checkItems(
  kinds: readonly Kind[],
  items: readonly Item[],
): DocumentViolation[] {
  const violations: DocumentViolation[] = [];
  const byKind = new Map<string, Item[]>();
  for (const item of items) {
    byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  }
  const keysOf = new Map(
    [...byKind].map(([name, list]) => [name, new Set(list.map((i) => i.key))]),
  );

  for (const kind of kinds) {
    const mine = byKind.get(kind.name) ?? [];
    const violate = (
      item: Item,
      rule: DocumentViolation["rule"],
      field: string,
      message: string,
    ) =>
      violations.push({
        source: "document",
        rule,
        kind: kind.name,
        path: item.path,
        field,
        message,
      });

    for (const name of uniqueFields(kind)) {
      const owners = new Map<unknown, Set<Item>>();
      for (const item of mine) {
        const raw = name === "file" ? item.file : item.fields[name];
        for (const value of valuesOf(raw)) {
          owners.set(value, (owners.get(value) ?? new Set()).add(item));
        }
      }
      const dupes = new Set<Item>();
      for (const holders of owners.values()) {
        if (holders.size > 1) holders.forEach((item) => dupes.add(item));
      }
      for (const item of dupes) {
        violate(
          item,
          "unique",
          name,
          `field ${name} must be unique within kind ${kind.name}`,
        );
      }
    }

    for (const [name, field] of Object.entries(kind.fields)) {
      const targets = field.type === "ref" ? keysOf.get(field.to!) : undefined;
      // 가리키는 kind가 없으면 kinds 파일 오류이고 그 kind의 item이 없다는 뜻이 아니므로 건너뛴다.
      const targetDeclared = field.type === "ref" &&
        kinds.some((other) => other.name === field.to);
      const pattern = field.pattern === undefined
        ? undefined
        : new RegExp(field.pattern);
      for (const item of mine) {
        const values = valuesOf(item.fields[name]);
        if (
          field.type === "ref" && targetDeclared &&
          values.some((value) => !(targets?.has(String(value)) ?? false))
        ) {
          violate(
            item,
            "ref",
            name,
            `field ${name} refers to a ${field.to} item that does not exist`,
          );
        }
        if (
          field.type === "enum" &&
          values.some((value) => !field.values!.includes(String(value)))
        ) {
          violate(
            item,
            "enum",
            name,
            `field ${name} is not one of the allowed values`,
          );
        }
        if (
          pattern !== undefined &&
          values.some((value) => !pattern.test(String(value)))
        ) {
          violate(
            item,
            "pattern",
            name,
            `field ${name} does not match its pattern`,
          );
        }
      }
    }
  }
  return violations;
}
