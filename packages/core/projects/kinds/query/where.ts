// 조건을 item 한 줄에 대해 판정한다. list 칸은 원소 하나라도 맞으면 참이다.
import type { KindCondition } from "../../../../protocol/projects/mod.ts";
import { type Row, valueAt } from "./fields.ts";

type Scalar = string | number | boolean;
type Leaf = {
  field: string;
  op: string;
  value?: Scalar | Scalar[];
};
type Condition =
  | Leaf
  | {
      all?: Condition[];
      any?: Condition[];
      not?: Condition;
    };

export function evaluate(condition: KindCondition, row: Row): boolean {
  return test(condition as Condition, row);
}

function test(condition: Condition, row: Row): boolean {
  if ("field" in condition) return evaluateLeaf(condition, row);
  if (condition.all !== undefined) {
    return condition.all.every((c) => test(c, row));
  }
  if (condition.any !== undefined) {
    return condition.any.some((c) => test(c, row));
  }
  return !test(condition.not!, row);
}

// 조건이 가리키는 칸 이름
export function conditionFields(condition: KindCondition): string[] {
  const walk = (c: Condition): string[] =>
    "field" in c
      ? [c.field]
      : [...(c.all ?? []), ...(c.any ?? []), ...(c.not ? [c.not] : [])].flatMap(
          walk,
        );
  return walk(condition as Condition);
}

function evaluateLeaf(leaf: Leaf, row: Row): boolean {
  const actual = valueAt(row, leaf.field);
  if (leaf.op === "exists") {
    return actual !== null && !(Array.isArray(actual) && actual.length === 0);
  }
  if (leaf.op === "ne") {
    return !anyItem(actual, (item) => equals(item, leaf.value));
  }
  if (leaf.op === "contains") return contains(actual, leaf.value);
  return anyItem(actual, (item) => compare(leaf.op, item, leaf.value));
}

function anyItem(actual: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(actual) ? actual.some(check) : check(actual);
}

function equals(item: unknown, target: unknown): boolean {
  return Array.isArray(target)
    ? target.some((t) => t === item)
    : item === target;
}

function compare(op: string, item: unknown, target: unknown): boolean {
  switch (op) {
    case "eq":
    case "in":
      return equals(item, target);
    case "lt":
      return order(item, target, (a, b) => a < b);
    case "lte":
      return order(item, target, (a, b) => a <= b);
    case "gt":
      return order(item, target, (a, b) => a > b);
    case "gte":
      return order(item, target, (a, b) => a >= b);
    default:
      return false;
  }
}

// number끼리는 수, 문자열끼리는 code unit 순이다. 그 밖(null, 섞인 type)은 거짓이다.
function order(
  item: unknown,
  target: unknown,
  check: (a: number | string, b: number | string) => boolean,
): boolean {
  if (typeof item === "number" && typeof target === "number") {
    return check(item, target);
  }
  if (typeof item === "string" && typeof target === "string") {
    return check(item, target);
  }
  return false;
}

function contains(actual: unknown, target: unknown): boolean {
  const targets = Array.isArray(target) ? target : [target];
  if (Array.isArray(actual)) {
    return targets.some((t) => actual.some((item) => item === t));
  }
  if (typeof actual !== "string") return false;
  return targets.some((t) => typeof t === "string" && actual.includes(t));
}
