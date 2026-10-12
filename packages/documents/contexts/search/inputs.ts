// 선언 검색의 입력 값을 선언에 맞춰 검사한다. 선언된 입력을 선언 순서로 먼저 보고, 그 다음 선언에 없는 이름을 code unit 순으로 본다.
import type {
  DeclaredSearch,
  SearchInput,
} from "../../../protocol/projects/mod.ts";
import type { InputValues, SearchError } from "./types.ts";

type Resolved =
  | { ok: true; inputs: InputValues }
  | { ok: false; error: SearchError };

export function resolveInputs(
  search: DeclaredSearch,
  values: InputValues,
): Resolved {
  const inputs: Record<string, unknown> = {};
  for (const input of search.inputs) {
    const value = given(values, input.name);
    // 주지 않았거나 null인 입력: 선택은 뺀다, required는 빠진 것이다.
    if (value === undefined || value === null) {
      if (input.required) return fail("input_required", input.name);
      continue;
    }
    if (!fitsInput(input, value)) return fail("input_invalid", input.name);
    inputs[input.name] = value;
  }

  const declared = new Set(search.inputs.map((input) => input.name));
  // 기본 정렬은 code unit 순이다.
  const undeclared = Object.keys(values)
    .filter((name) => !declared.has(name) && values[name] !== undefined)
    .sort();
  if (undeclared.length > 0) return fail("input_invalid", undeclared[0]);

  return { ok: true, inputs };
}

// Object.hasOwn으로 보아 "constructor" 같은 이름이 프로토타입 값을 잡지 않게 한다.
function given(values: InputValues, name: string): unknown {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

function fail(
  code: SearchError["code"],
  input: string,
): { ok: false; error: SearchError } {
  return { ok: false, error: { code, input } };
}

// many면 배열이고 항목마다 한 입력의 모양을 본다.
function fitsInput(input: SearchInput, value: unknown): boolean {
  if (!input.many) return fitsOne(input, value);
  return Array.isArray(value) && value.every((item) => fitsOne(input, item));
}

function fitsOne(input: SearchInput, value: unknown): boolean {
  if (input.type === "entity" || input.type === "text") {
    return typeof value === "string";
  }
  if (input.type === "value") return isScalar(value);
  return fitsRange(value);
}

// entity·value·text의 한 값. value의 값은 string·number·boolean이다.
function isScalar(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean";
}

// range는 {from?, to?}이고 양 끝 중 하나는 있어야 한다. 끝 값은 비교가 되는 string·number다.
function fitsRange(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((key) => {
    if (key !== "from" && key !== "to") return false;
    const end = (value as Record<string, unknown>)[key];
    return typeof end === "string" || typeof end === "number";
  });
}
