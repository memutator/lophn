// The module's answers as Results, without React Native (node --test reads this file). The Kotlin side answers a JSON
// string: {"ok":true,"value":…} or {"ok":false,"code":…,"reason":…,"message":…}.
import type { z } from "zod";
import { ERROR_CODES, type ErrorCode, internalError, type LophnError } from "../../../../base/errors.ts";
import { err, ok, type Result } from "../../../../base/result.ts";

const isCode = (code: unknown): code is ErrorCode =>
  typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code);

// A value that does not fit the contract is `internal`: core never gets a shape it did not agree to.
export function readAnswer<T>(raw: unknown, schema: z.ZodType<T>): Result<T> {
  let answer: unknown;
  try {
    answer = JSON.parse(String(raw));
  } catch {
    return err(internalError());
  }
  if (typeof answer !== "object" || answer === null) return err(internalError());
  const a = answer as { ok?: unknown; value?: unknown; code?: unknown; reason?: unknown; message?: unknown };
  if (a.ok === true) {
    const value = schema.safeParse(a.value);
    return value.success ? ok(value.data) : err(internalError());
  }
  if (!isCode(a.code)) return err(internalError());
  const error: LophnError = { code: a.code, message: typeof a.message === "string" ? a.message : a.code };
  if (typeof a.reason === "string") error.details = { reason: a.reason };
  return err(error);
}

// A build without the module (iOS, a build from before it).
export const missingModule = (): Result<never> =>
  err({ code: "unavailable", message: "This build of the app cannot drive screens.", details: { reason: "unsupported" } });
