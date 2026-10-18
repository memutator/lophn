// 보고 검사가 쓰는 사실 묶음과 그 read route. core가 정본 표에서 모은 사실만 담는다.
import { z } from "zod";
import {
  acceptanceCheckSchema,
  checkResultSchema,
  ticketIdSchema,
} from "../../../../protocol/coding-agent/ticket/mod.ts";
import { defineRead, idSchema } from "../../../../protocol/base/mod.ts";

// 같은 app의 Verification 사실. problems/tests가 소유한 행의 읽기 값이다.
const verificationFactSchema = z.object({
  id: idSchema("vrf"),
  kind: z.enum(["app_test", "examples"]),
  app: idSchema("app"),
  result: checkResultSchema,
  reason: z.string(),
  bundle_hash: z.string(),
  ticket: z.object({ ticket: ticketIdSchema, completion_seq: z.string() })
    .nullable(),
});
export type VerificationFact = z.infer<typeof verificationFactSchema>;

export const checkWorkSchema = z.object({
  ticket: ticketIdSchema,
  app: idSchema("app"),
  // 읽은 ticket의 revision. record_checks의 base_revision이다.
  revision: z.string(),
  completion_seq: z.string(),
  release: z.object({
    id: idSchema("rel"),
    app: idSchema("app"),
    bundle_hash: z.string(),
  }).nullable(),
  check: acceptanceCheckSchema,
  // 이 보고 release의 bundle과 이 보고에 이어진 Verification.
  verifications: z.array(verificationFactSchema),
});
export type CheckWork = z.infer<typeof checkWorkSchema>;

// 보고된 ticket이 아니거나 읽는 보고가 최신이 아니면 work는 null이다.
export const ticketCheckWork = defineRead({
  resource: "tickets",
  method: "check_work",
  name: "TicketCheckWork",
  input: z.strictObject({
    ticket: ticketIdSchema,
    completion_seq: z.string(),
  }),
  output: z.object({
    work: checkWorkSchema.nullable(),
    as_of_seq: z.string(),
    next_cursor: z.string().nullable(),
  }),
  actors: ["machine"],
  errors: ["forbidden", "invalid_input"],
});
