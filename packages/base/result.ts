import type { LophnError } from "./errors.ts";

export type Result<T, E = LophnError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = LophnError>(error: E): Result<never, E> {
  return { ok: false, error };
}
