// 조건을 한 행에 대해 판정한다.
import type { Condition } from "../../../contracts/documents/mod.ts";
import type { InputValues, Row } from "./types.ts";

export function evaluate(
  _condition: Condition,
  _row: Row,
  _inputs: InputValues,
): boolean {
  return true;
}
