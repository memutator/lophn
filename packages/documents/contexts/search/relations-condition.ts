// follow.where 판정. 별칭이 붙은 행에서 조건을 본다. 주지 않은 입력을 쓰는 비교는 참이다.
import type { Condition } from "../../../contracts/documents/mod.ts";
import { valueAt } from "./row.ts";
import type { InputValues, Row } from "./types.ts";

type Comparison = Extract<Condition, { path: string }>;

function isInputRef(value: unknown): value is { input: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return null;
}

function holds(op: Comparison["op"], actual: unknown, expected: unknown) {
  if (op === "exists") return actual !== null && actual !== undefined;
  const list = Array.isArray(expected) ? expected : [expected];
  switch (op) {
    case "eq":
    case "in":
      return list.includes(actual);
    case "ne":
      return !list.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return list.every((v) => actual.includes(v));
      return typeof actual === "string" &&
        list.every((v) => typeof v === "string" && actual.includes(v));
    default: {
      const order = compare(actual, expected);
      if (order === null) return false;
      return op === "lt"
        ? order < 0
        : op === "lte"
        ? order <= 0
        : op === "gt"
        ? order > 0
        : order >= 0;
    }
  }
}

export function passes(
  condition: Condition,
  row: Row,
  inputs: InputValues,
): boolean {
  if ("all" in condition) {
    return condition.all.every((c) => passes(c, row, inputs));
  }
  if ("any" in condition) {
    return condition.any.some((c) => passes(c, row, inputs));
  }
  if ("not" in condition) return !passes(condition.not, row, inputs);
  let expected: unknown = condition.value;
  if (isInputRef(expected)) {
    if (!(expected.input in inputs)) return true;
    expected = inputs[expected.input];
  }
  return holds(condition.op, valueAt(row, condition.path), expected);
}
