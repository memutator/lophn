// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

type ValidationError = { code: "invalid_input"; message: string };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationError };

export type InputType =
  | "object"
  | "array"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null";

export type InputSchema = {
  type: InputType;
  description?: string;
  enum?: JsonValue[];
  default?: JsonValue;
  properties?: { [key: string]: InputSchema };
  required?: string[];
  additionalProperties?: false;
  items?: InputSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

// packages/protocol/problems의 ProblemCodeDeclaration과 같은 구조다. import하지 않는다.

export const INPUT_KEYS = [
  "additionalProperties",
  "default",
  "description",
  "enum",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "properties",
  "required",
  "type",
] as const;

export const INPUT_TYPES = new Set<InputType>([
  "object",
  "array",
  "string",
  "integer",
  "number",
  "boolean",
  "null",
]);

export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function invalid(message: string): ValidationResult<never> {
  return { ok: false, error: { code: "invalid_input", message } };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ownKeys(value: Record<string, unknown>): string[] | undefined {
  if (Object.getOwnPropertySymbols(value).length > 0) return;
  return Object.keys(value);
}

// JSON key는 prototype setter를 호출하지 않는 own data property로 복사한다.
export function defineOwn<T>(object: Record<string, T>, key: string, value: T) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export function rejectSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export function lengthOf(value: string): number {
  return [...value].length;
}

export function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): string | undefined {
  const keys = ownKeys(value);
  if (!keys) return "unsupported object key";
  const known = new Set(allowed);
  for (const key of keys) {
    if (!known.has(key)) return `unknown field ${key}`;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return `missing field ${key}`;
  }
}

export function integerBound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function numberBound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function sameJson(left: JsonValue, right: JsonValue): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
    case "number":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
      }
      const keys = Object.keys(value).sort();
      return `{${
        keys.map((key) =>
          `${JSON.stringify(key)}:${stableJson(value[key] as JsonValue)}`
        ).join(",")
      }}`;
    }
    default:
      return "null";
  }
}

function jsonType(value: JsonValue): InputType | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "string":
      return rejectSurrogate(value) ? undefined : "string";
    case "number":
      return Number.isFinite(value)
        ? Number.isInteger(value) ? "integer" : "number"
        : undefined;
    case "object":
      return Array.isArray(value) ? "array" : "object";
    default:
      return;
  }
}

export function matchesType(type: InputType, value: JsonValue): boolean {
  const actual = jsonType(value);
  if (actual === undefined) return false;
  return type === "number"
    ? actual === "number" || actual === "integer"
    : actual === type;
}

function copyJson(
  value: unknown,
  seen: Set<object>,
): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return rejectSurrogate(value) ? undefined : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) return;
    seen.add(value);
    const copy: JsonValue[] = [];
    for (const item of value) {
      const copied = copyJson(item, seen);
      if (copied === undefined && item !== null) return;
      copy.push(copied as JsonValue);
    }
    seen.delete(value);
    return copy;
  }
  if (!isObject(value)) return;
  const keys = ownKeys(value);
  if (!keys) return;
  seen.add(value);
  const copy: JsonObject = {};
  for (const key of keys) {
    if (rejectSurrogate(key)) return;
    const copied = copyJson(value[key], seen);
    if (copied === undefined && value[key] !== null) return;
    defineOwn(copy, key, copied as JsonValue);
  }
  seen.delete(value);
  return copy;
}

export function asJson(value: unknown): JsonValue | undefined {
  return copyJson(value, new Set());
}
