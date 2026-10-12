// Search 탭의 입력 값 다루기(shell/workspace#R23). 비운 입력은 값이 없는 것으로 본다.
import type { DeclaredSearch, SearchInputValues } from "./source.ts";

function isUnset(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isUnset);
  }
  return false;
}

/** 입력 하나를 바꾼다. 비운 값("", 빈 목록, 빈 범위)은 그 입력을 지운다. */
export function withInput(
  inputs: SearchInputValues,
  name: string,
  value: unknown,
): SearchInputValues {
  const { [name]: _removed, ...rest } = inputs;
  return isUnset(value) ? rest : { ...rest, [name]: value };
}

/** 꼭 채워야 하는데 비어 있는 입력. 있으면 결과를 읽지 않는다. */
export function missingInputs(
  search: DeclaredSearch,
  inputs: SearchInputValues,
): DeclaredSearch["inputs"] {
  return search.inputs.filter((input) =>
    input.required && isUnset(inputs[input.name])
  );
}

/** 입력 form이 후보를 보이는 입력(고르는 입력). */
export function pickInputs(search: DeclaredSearch): DeclaredSearch["inputs"] {
  return search.inputs.filter((input) =>
    input.type === "entity" || input.type === "value"
  );
}
