// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import { defineOwn, type JsonObject, type JsonValue } from "./types.ts";

export function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const keys = Object.keys(value).sort();
      return `{${
        keys.map((key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`
        ).join(",")
      }}`;
    }
    default:
      return "null";
  }
}

export function sortKeys<T extends { key: string }>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  );
}

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

export function unique(values: string[], label: string): string | undefined {
  if (new Set(values).size !== values.length) return `duplicate ${label}`;
}
