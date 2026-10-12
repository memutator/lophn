// 조건을 한 행에 대해 판정한다. 규칙은 docs/domain-model/documents/contexts.md "실행 규칙"이다.
import type { Condition } from "../../../protocol/projects/mod.ts";
import { valueAt } from "./row.ts";
import type { InputValues, Row } from "./types.ts";

type Leaf = Extract<Condition, { path: string }>;
type Range = { from?: unknown; to?: unknown };

export function evaluate(
  condition: Condition,
  row: Row,
  inputs: InputValues,
): boolean {
  if ("all" in condition) {
    return condition.all.every((c) => evaluate(c, row, inputs));
  }
  if ("any" in condition) {
    return condition.any.some((c) => evaluate(c, row, inputs));
  }
  if ("not" in condition) return !evaluate(condition.not, row, inputs);
  return evaluateLeaf(condition, row, inputs);
}

function evaluateLeaf(
  condition: Leaf,
  row: Row,
  inputs: InputValues,
): boolean {
  const actual = valueAt(row, condition.path);
  if (condition.op === "exists") {
    return actual !== null && !(Array.isArray(actual) && actual.length === 0);
  }
  const declared = condition.value;
  let target: unknown = declared;
  if (isInputRef(declared)) {
    // 주지 않은 선택 입력을 가리키는 조건은 참이다.
    if (!Object.hasOwn(inputs, declared.input)) return true;
    target = inputs[declared.input];
    if (target === undefined) return true;
  }
  if (condition.op === "ne") return !matches("eq", actual, target);
  return matches(condition.op, actual, target);
}

function isInputRef(value: unknown): value is { input: string } {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value) && "input" in value;
}

function isRange(value: unknown): value is Range {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 경로 값이 list면 항목 중 하나라도 맞으면 참이다.
function matches(op: string, actual: unknown, target: unknown): boolean {
  if (isRange(target)) {
    return op === "eq" && anyItem(actual, (item) => inRange(item, target));
  }
  if (op === "contains") return contains(actual, target);
  return anyItem(actual, (item) => compare(op, item, target));
}

function anyItem(
  actual: unknown,
  test: (item: unknown) => boolean,
): boolean {
  return Array.isArray(actual) ? actual.some(test) : test(actual);
}

function compare(op: string, item: unknown, target: unknown): boolean {
  switch (op) {
    case "eq":
    case "in":
      return Array.isArray(target)
        ? target.some((t) => t === item)
        : item === target;
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
  test: (a: number | string, b: number | string) => boolean,
): boolean {
  if (typeof item === "number" && typeof target === "number") {
    return test(item, target);
  }
  if (typeof item === "string" && typeof target === "string") {
    return test(item, target);
  }
  return false;
}

function inRange(item: unknown, range: Range): boolean {
  return (range.from === undefined || compare("gte", item, range.from)) &&
    (range.to === undefined || compare("lte", item, range.to));
}

function contains(actual: unknown, target: unknown): boolean {
  const targets = Array.isArray(target) ? target : [target];
  if (Array.isArray(actual)) {
    return targets.some((t) => actual.some((item) => item === t));
  }
  if (typeof actual !== "string") return false;
  return targets.some((t) => typeof t === "string" && actual.includes(t));
}
