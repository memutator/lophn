import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { z } from "zod";

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    // core log와 trace를 찾는 열쇠(W3C trace id, 32 hex). 응답을 낸 요청의 trace다.
    trace_id: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    // 부른 쪽이 다음에 할 일 한 줄. code마다 정해진 문장이다.
    hint: z.string().optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

// ledger 오류 분류 순서와 같다.
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
