import {
  canonicalize,
  err,
  internalError,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { z } from "zod";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// getter는 한 번만 읽는다. schema strip이나 metadata 덮어쓰기가 raw 비JSON을 숨기면 안 된다.
function copyJson(raw: unknown, ancestors = new Set<object>()): Json {
  if (raw === null) return null;
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || Object.is(raw, -0)) {
      throw new TypeError("output requires JSON numbers without negative zero");
    }
    return raw;
  }
  if (typeof raw !== "object") {
    throw new TypeError(`output requires JSON values (got ${typeof raw})`);
  }
  if (ancestors.has(raw)) {
    throw new TypeError("output requires acyclic JSON values");
  }
  if (Object.getOwnPropertySymbols(raw).length > 0) {
    throw new TypeError("output rejects symbol keys");
  }
  ancestors.add(raw);
  try {
    if (Array.isArray(raw)) {
      if (
        Object.keys(raw).some((key) => {
          const index = Number(key);
          return !Number.isSafeInteger(index) || index < 0 ||
            index >= raw.length ||
            String(index) !== key;
        })
      ) {
        throw new TypeError("output rejects extra array properties");
      }
      return Array.from(
        { length: raw.length },
        (_, index) => copyJson(raw[index], ancestors),
      );
    }
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("output requires plain objects");
    }
    const copied: { [key: string]: Json } = Object.create(null);
    for (const key of Object.keys(raw)) {
      copied[key] = copyJson((raw as Record<string, unknown>)[key], ancestors);
    }
    return copied;
  } finally {
    ancestors.delete(raw);
  }
}

// 최종 JSON이 schema를 다시 지나 같은 값이어야 저장·송신할 수 있다.
// overrides도 raw 검사 뒤에만 적용한다. reader의 as_of_seq가 잘못된 raw field를 지우지 못한다.
export function validateOutput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  overrides?: Readonly<Record<string, unknown>>,
): Result<z.output<S>> {
  try {
    const copied: Json = JSON.parse(canonicalize(copyJson(raw)));
    if (overrides !== undefined) {
      if (
        copied === null || typeof copied !== "object" || Array.isArray(copied)
      ) {
        return err(internalError());
      }
      Object.assign(copied, JSON.parse(canonicalize(copyJson(overrides))));
    }
    const parsed = schema.safeParse(copied);
    if (!parsed.success) return err(internalError());
    const text = canonicalize(copyJson(parsed.data));
    const wire: unknown = JSON.parse(text);
    const again = schema.safeParse(wire);
    if (!again.success || canonicalize(copyJson(again.data)) !== text) {
      return err(internalError());
    }
    // schema callback이 재검증 입력을 바꿔도 그 object를 밖으로 내보내지 않는다.
    return ok(JSON.parse(text) as z.output<S>);
  } catch {
    return err(internalError());
  }
}
