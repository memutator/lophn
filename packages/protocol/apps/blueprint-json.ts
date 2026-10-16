// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import {
  defineOwn,
  type JsonObject,
  type JsonValue,
} from "./blueprint-types.ts";

export function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === "object") {
    const copy: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      defineOwn(copy, key, normalizeJson(value[key] as JsonValue));
    }
    return copy;
  }
  return value;
}
