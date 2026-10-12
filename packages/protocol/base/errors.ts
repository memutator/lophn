import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { z } from "zod";

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

// platform/ledger 오류 분류 순서와 같다.
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

const STATUS_CODE = Object.fromEntries(
  Object.entries(ERROR_HTTP_STATUS).map(([code, status]) => [status, code]),
) as Record<number, ErrorCode>;

export function errorCodeForStatus(status: number): ErrorCode | undefined {
  return STATUS_CODE[status];
}
