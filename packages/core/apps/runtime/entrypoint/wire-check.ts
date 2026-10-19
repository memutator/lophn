// 순수 wire 판정 도우미. Zod 없이 contracts schema와 같은 거절을 만든다.
import { SOCKET_PATH_MAX_BYTES } from "./limits.ts";

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const SHA = /^[0-9a-f]{64}$/;
export const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTROL = /\p{Cc}/u;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

function ownKeys(value: object): string[] | undefined {
  const keys = Object.keys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || descriptor.get) return;
  }
  return keys;
}

export function isJson(value: unknown): value is Json {
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value)) return value.every(isJson);
      const keys = ownKeys(value);
      if (!keys) return false;
      return keys.every((key) =>
        isJson((value as Record<string, unknown>)[key])
      );
    }
    default:
      return false;
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  return ownKeys(value) ? value as Record<string, unknown> : undefined;
}

// 모르는 칸이나 빠진 칸의 이름을 돌려준다. 없으면 undefined다.
export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  required: readonly string[] = keys,
): string | undefined {
  const known = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) return `unknown field ${key}`;
  }
  for (const key of required) {
    if (!(key in value)) return `missing field ${key}`;
  }
  return;
}

export function text(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  return CONTROL.test(value) ? undefined : value;
}

export function id(value: unknown, prefix: string): string | undefined {
  if (typeof value !== "string") return;
  const body = value.slice(prefix.length + 1);
  if (value.startsWith(`${prefix}_`) && ULID.test(body)) return value;
  return;
}

// toolKeySchema와 같은 검사다.
export function appToolKey(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  if (value.trim() !== value || CONTROL.test(value) || value.includes("*")) {
    return;
  }
  return value;
}

export function endpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  if (new TextEncoder().encode(value).byteLength >= SOCKET_PATH_MAX_BYTES) {
    return;
  }
  return value;
}
