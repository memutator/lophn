import { REDACTION_SCREEN_STRING_MAX_CHARS } from "../../protocol/server/mod.ts";
import { personalKey, selectSafeFields } from "./fields.ts";

// 80자를 넘는 화면 문자열의 안전 shape. 원문 길이는 담지 않는다(R7, R12).
export const SCREEN_LONG_STRING = { kind: "long_string" } as const;

// 화면 문자열 80자 초과는 안전 shape, private 필드는 통째로 뺀다(R12).
// 짧은 이메일·이름·연락처·경로도 개인정보 검사를 생략하지 않는다.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}/;
const PATH = /(?:^|[\s"'`])(?:\/|~\/)[^\s"'`]*/;

export type ScreenOutcome =
  | { ok: true; value: unknown; omitted: string[] }
  | { ok: false; reason: "invalid_input" };

function personal(value: string, key: string): boolean {
  return EMAIL.test(value) || PHONE.test(value) || PATH.test(value) ||
    personalKey(key);
}

function shapeString(
  value: string,
  key: string,
): string | typeof SCREEN_LONG_STRING | undefined {
  if (personal(value, key)) return undefined;
  if (value.length > REDACTION_SCREEN_STRING_MAX_CHARS) {
    return SCREEN_LONG_STRING;
  }
  return value;
}

function joinPath(location: string, key: string): string {
  return location === "" ? key : `${location}.${key}`;
}

function walk(
  value: unknown,
  key: string,
  omitted: string[],
  location: string,
): unknown {
  if (typeof value === "string") {
    const next = shapeString(value, key);
    if (next === undefined) {
      omitted.push(location);
      return undefined;
    }
    return next;
  }
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const child = walk(
        value[index],
        key,
        omitted,
        `${location}[${index}]`,
      );
      if (child !== undefined) next.push(child);
    }
    return next;
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const childKey of Object.keys(value as Record<string, unknown>)) {
      const childLocation = joinPath(location, childKey);
      const child = walk(
        (value as Record<string, unknown>)[childKey],
        childKey,
        omitted,
        childLocation,
      );
      if (child !== undefined) next[childKey] = child;
    }
    return next;
  }
  return value;
}

export function redactScreen(
  value: unknown,
  safeFields: readonly string[],
  privateFields: readonly string[],
): ScreenOutcome {
  const selected = selectSafeFields(value, safeFields, privateFields);
  if (!selected) return { ok: false, reason: "invalid_input" };
  const omitted = [...selected.dropped];
  const shaped = walk(selected.value, "", omitted, "");
  return { ok: true, value: shaped, omitted };
}
