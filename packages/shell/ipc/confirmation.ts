// 결정 handle IPC 모양. shell tsc는 packages를 보지 않으므로 통로에 필요한 schema만 여기 둔다.
import { z } from "zod";

export { DECISION_HANDLE_CHANNEL } from "./confirmation-channels.ts";

const ID = /^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const CONCERN = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)+$/;
const DECISION = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
// 공백만이 아닌 한 줄.
const ONE_LINE = /^[^\r\n]*\S[^\r\n]*$/;

const ownerDecisionSchema = z.object({
  kind: z.literal("owner_decision"),
  concern: z.string().regex(CONCERN),
  decision: z.string().regex(DECISION),
  targets: z.array(z.string().regex(ID)).min(1).refine((values) =>
    new Set(values).size === values.length
  ).optional(),
  choice: z.enum([
    "fixed",
    "not_fixed",
    "not_visible",
    "dismiss",
    "restore_all",
    "messages_only",
    "summarize",
  ]).optional(),
  note: z.string().regex(ONE_LINE).optional(),
}).strict();

// 창 없는 사람 결정 handle 요청. owner_decision 참조와 같은 칸이다.
export const decisionHandleRequestSchema = ownerDecisionSchema.omit({
  kind: true,
});

export type DecisionHandleRequest = z.infer<typeof decisionHandleRequestSchema>;

export type DecisionHandleReply =
  | { confirmation: string; expires_at: string }
  | {
    error: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  };

export interface DecisionHandleApi {
  requestDecisionHandle(
    request: DecisionHandleRequest,
  ): Promise<DecisionHandleReply>;
}
