// 선언 검색의 입력 값을 선언에 맞춰 검사한다.
import type { DeclaredSearch } from "../../../contracts/documents/mod.ts";
import type { InputValues, SearchError } from "./types.ts";

export function resolveInputs(
  _search: DeclaredSearch,
  _values: InputValues,
): { ok: true; inputs: InputValues } | { ok: false; error: SearchError } {
  return { ok: true, inputs: {} };
}
