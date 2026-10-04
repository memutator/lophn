// 순수 wire 판정 도우미. Zod 없이 contracts schema와 같은 거절을 만든다.
import { SOCKET_PATH_MAX_BYTES } from "./limits.ts";

export const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const AT =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
export const SHA = /^[0-9a-f]{64}$/;
export const CONTROL = /\p{Cc}/u;

export type WireError = { message: string };

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export function fail(message: string): { ok: false; error: WireError } {
  return { ok: false, error: { message } };
}

export function ownKeys(value: object): string[] | undefined {
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

export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const known = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) return `unknown field ${key}`;
  }
  return;
}

export function text(value: unknown, name: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  if (CONTROL.test(value)) return `${name} contains a control character`;
  return value;
}

export function id(value: unknown, prefix: string): string | undefined {
  if (typeof value !== "string") return;
  const body = value.slice(prefix.length + 1);
  if (value.startsWith(`${prefix}_`) && ULID.test(body)) return value;
  return;
}

export function opaque(value: unknown, name: string): string | undefined {
  return text(value, name);
}

export function commandKey(value: unknown): string | undefined {
  const key = text(value, "command key");
  if (!key || key.trim().length === 0 || key.includes("*")) return;
  return key;
}

export function screenKey(value: unknown): string | undefined {
  const key = text(value, "screen key");
  if (!key || key.trim().length === 0) return;
  return key;
}

export function endpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  if (new TextEncoder().encode(value).byteLength >= SOCKET_PATH_MAX_BYTES) {
    return;
  }
  return value;
}

export function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function stringList(
  value: unknown,
  item: (value: unknown) => string | undefined,
): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => item(entry))) return;
  const list = value as string[];
  return unique(list) ? list : undefined;
}
