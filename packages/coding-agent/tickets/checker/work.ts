// checker가 판정에 쓰는 사실 묶음과 그 read route(coding-agent/tickets#R18, R19, R20).
// core가 정본 표에서 모은 사실만 담는다. 판정은 judge.ts가 한다.
import { z } from "zod";
import {
  ticketConditionSchema,
  ticketIdSchema,
} from "../../../contracts/coding-agent/mod.ts";
import { defineRead, idSchema } from "../../../contracts/platform/mod.ts";

export const CHECK_WORK_PAGE = 50;

const link = z.object({
  ticket: ticketIdSchema,
  check_index: z.number().int().min(0),
  check_hash: z.string(),
  completion_seq: z.string(),
});

// 같은 app의 Verification 사실. problems/tests가 소유한 행의 읽기 값이다.
export const verificationFactSchema = z.object({
  id: idSchema("vrf"),
  kind: z.enum(["app_test", "reproduction", "test_command"]),
  app: idSchema("app"),
  result: z.enum(["pass", "fail", "inconclusive"]),
  reason: z.string(),
  bundle_hash: z.string(),
  ticket: link.nullable(),
  // reproduction만 갖는다: 대상 문제, 고정 test hash, after release(R9).
  problem: idSchema("prb").nullable().default(null),
  test: z.string().nullable().default(null),
  after_release: idSchema("rel").nullable().default(null),
});
export type VerificationFact = z.infer<typeof verificationFactSchema>;

export const releaseFactSchema = z.object({
  id: idSchema("rel"),
  app: idSchema("app"),
  bundle_hash: z.string(),
  status: z.enum(["prepared", "activating", "active", "failed", "superseded"]),
  failure: z.string().nullable(),
});
export type ReleaseFact = z.infer<typeof releaseFactSchema>;

// problems/closing이 이미 판정한 문제 닫힘의 읽기 값이다. 이 checker는 읽기만 한다(R21).
// user_confirmed 닫힘의 confirmation은 사람 결정의 참조(`ApplyProblemDecision@<basis_seq>`)다.
export const problemFactSchema = z.object({
  id: idSchema("prb"),
  app: idSchema("app"),
  // 문제의 최신 event seq. 닫힘·재발마다 바뀌는 비교 대상 revision이다.
  seq: z.string().default("0"),
  status: z.enum(["open", "fixing", "closed"]),
  // 사람이 "아직입니다"(not_fixed)라고 한 release. 그 뒤 닫힘이 있으면 null이다.
  not_fixed_release: idSchema("rel").nullable().default(null),
  closure: z.object({
    reason: z.enum(["verified", "user_confirmed", "recovered", "dismissed"]),
    release: idSchema("rel").nullable(),
    verification: idSchema("vrf").nullable(),
    confirmation: z.string().nullable(),
    basis_seq: z.string(),
  }).nullable(),
});
export type ProblemFact = z.infer<typeof problemFactSchema>;

export const checkWorkSchema = z.object({
  ticket: ticketIdSchema,
  app: idSchema("app"),
  // 읽은 ticket의 revision. record_checks의 base_revision이다.
  revision: z.string(),
  completion: z.object({
    seq: z.string(),
    release: idSchema("rel"),
    verifications: z.array(idSchema("vrf")),
  }),
  conditions: z.array(ticketConditionSchema),
  // 이 completion에 이미 기록된 조건별 결과. 같은 사실을 다시 쓰지 않는 데 쓴다.
  recorded: z.array(z.object({
    condition: z.number().int().min(0),
    result: z.enum(["pass", "fail", "inconclusive"]),
  })),
  release: releaseFactSchema.nullable(),
  // 앱 정본이 가리키는 active release와 그 revision. 비교한 대상이다.
  app_state: z.object({
    revision: z.string(),
    active_release: idSchema("rel").nullable(),
  }).nullable(),
  verifications: z.array(verificationFactSchema),
  // 이 ticket이 고치는 문제(Ticket.problems)와 그 문제의 닫힘 사실(R9, R21).
  problems: z.array(idSchema("prb")).default([]),
  problem_facts: z.array(problemFactSchema).default([]),
});
export type CheckWork = z.infer<typeof checkWorkSchema>;

export const ticketCheckWork = defineRead({
  resource: "tickets",
  method: "check_work",
  name: "TicketCheckWork",
  input: z.strictObject({
    ticket: ticketIdSchema.optional(),
    cursor: z.string().min(1).optional(),
  }),
  output: z.object({
    works: z.array(checkWorkSchema),
    as_of_seq: z.string(),
    next_cursor: z.string().nullable(),
  }),
  actors: ["machine"],
  errors: ["forbidden", "invalid_input"],
});
