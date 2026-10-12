import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import { seqSchema, sha256Schema } from "../base/values.ts";
import { ticketCheckResultSchema } from "./ticket-routes.ts";
import {
  sourceRelativePathSchema,
  TICKET_LIST_LIMIT,
  ticketClaimSchema,
  ticketConditionSchema,
  ticketIdSchema,
  ticketKindSchema,
} from "./ticket-values.ts";

// 사람 화면용 ticket read(coding-agent/tickets#R27). 여섯 진행 state와 readiness는 서로 다른 화면 상태
// 값 일곱 개로 나온다. 화면 말로 바꾸는 것은 shell이다(shell wording). 이 값들은 저장하지 않고
// 정본 state·readiness에서 읽을 때마다 계산한다.
export const TICKET_SCREEN_STATES = [
  // open, readiness needs_confirmation
  "needs_confirmation",
  // open, readiness ready
  "ready",
  // claimed (agent가 작업 중)
  "in_progress",
  "reported",
  "confirmed",
  "check_failed",
  "cancelled",
] as const;
export const ticketScreenStateSchema = z.enum(TICKET_SCREEN_STATES);
export type TicketScreenState = z.infer<typeof ticketScreenStateSchema>;

// 다음 행동은 정확히 하나다. 사람이 할 일이 없는 in_progress·cancelled는 null이다.
export const TICKET_NEXT_ACTIONS = [
  // [Start] 가능: ready이고 open 또는 check_failed
  "start",
  // needs_confirmation
  "needs_confirmation",
  // confirmed. 사람이 결과를 확인한다
  "check_result",
  // reported. 승인·운영 확인 등 남은 조건을 기다린다
  "waiting_for_approval",
] as const;
export const ticketNextActionSchema = z.enum(TICKET_NEXT_ACTIONS);
export type TicketNextAction = z.infer<typeof ticketNextActionSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "coding_agent", "agent", "machine"] as const;

const requestText = z.string().min(1).max(2000);
const title = z.string().min(1).max(120);

// 기본 data. 기한·연결·조건·보고·test 원문과 "claim"이라는 말은 이 모양에 없다.
export const ticketScreenSummarySchema = z.strictObject({
  id: ticketIdSchema,
  app: idSchema("app"),
  kind: ticketKindSchema,
  title,
  request: requestText,
  problem_count: z.number().int().min(0).max(12),
  screen_state: ticketScreenStateSchema,
  next_action: ticketNextActionSchema.nullable(),
});
export type TicketScreenSummary = z.infer<typeof ticketScreenSummarySchema>;

export const ticketScreenListInputSchema = z.strictObject({
  app: idSchema("app").optional(),
  screen_state: ticketScreenStateSchema.optional(),
  limit: z.number().int().min(1).max(TICKET_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});
export const ticketScreenListOutputSchema = withReadCommon(z.object({
  tickets: z.array(ticketScreenSummarySchema),
}));
export const ticketScreenList = defineRead({
  resource: "tickets",
  method: "screen_list",
  name: "ListTicketScreen",
  input: ticketScreenListInputSchema,
  output: ticketScreenListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// 펼친 상세. claim 기한·연결 ID·전체 조건·실제 검사 근거·남은 조건·보고 참조는 여기서만 나온다.
export const ticketScreenDetailSchema = ticketScreenSummarySchema.extend({
  why: requestText,
  needs: z.array(z.string()).max(12),
  problems: z.array(idSchema("prb")).max(12),
  inspect: z.array(sourceRelativePathSchema).max(20),
  preserve: z.array(sourceRelativePathSchema).max(20),
  claim: ticketClaimSchema.nullable(),
  conditions: z.array(ticketConditionSchema).max(12),
  completion: z.strictObject({
    seq: seqSchema,
    release: idSchema("rel"),
    summary_hash: sha256Schema,
    outputs: z.array(idSchema("ver")).max(20),
    fix_records: z.array(seqSchema).max(12),
    verifications: z.array(idSchema("vrf")).max(24),
  }).nullable(),
  checks: z.array(ticketCheckResultSchema).max(12),
  // 최신 보고에서 통과로 닫히지 않은 조건 번호
  remaining: z.array(z.number().int().min(0).max(11)).max(12),
  revision: seqSchema,
});
export const ticketScreenDetailInputSchema = z.strictObject({
  ticket: ticketIdSchema,
});
export const ticketScreenDetailOutputSchema = withReadCommon(z.object({
  ticket: ticketScreenDetailSchema,
}));
export const ticketScreenDetail = defineRead({
  resource: "tickets",
  method: "screen_detail",
  name: "ShowTicketScreen",
  input: ticketScreenDetailInputSchema,
  output: ticketScreenDetailOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const TICKET_SCREEN_ROUTES = [
  ticketScreenList,
  ticketScreenDetail,
] as const;
