import { z } from "zod";
import { type IdPrefix, ID_PREFIXES, idSchema } from "../base/ids.ts";
import {
  confirmationRefSchema,
  decisionNameSchema,
} from "../base/confirmation-handle.ts";
import { errorBodySchema } from "../base/errors.ts";
import { atSchema } from "../base/values.ts";

const CONCERN = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)+$/;

const concernSchema = z.string().regex(CONCERN);

function isIdPrefix(prefix: string): prefix is IdPrefix {
  return Object.hasOwn(ID_PREFIXES, prefix);
}

const anyIdSchema = z.string().refine(
  (value) => {
    const prefix = value.slice(0, value.indexOf("_"));
    return isIdPrefix(prefix) && idSchema(prefix).safeParse(value).success;
  },
  { message: "invalid id" },
);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const ownerDecisionIntentSchema = z.strictObject({
  kind: z.literal("owner_decision"),
  concern: concernSchema,
  decision: decisionNameSchema,
  targets: z.array(anyIdSchema).min(1).refine(unique, {
    message: "duplicate target",
  }).optional(),
  // 문제 결정(problems/closing)에서 사람이 고른 결정과 dismiss의 한 줄 이유, 또는 session 되돌리기
  // (lophn-agent/revert)에서 고른 범위. main은 문제나 preview를 독립 read해 handle을 묶는다.
  // Rewind의 대상은 [session, checkpoint(, 끝난 요약 call)]이다.
  choice: z.enum([
    "fixed",
    "not_fixed",
    "not_visible",
    "dismiss",
    "restore_all",
    "messages_only",
    "summarize",
  ]).optional(),
  note: z.string().regex(/^[^\r\n]*\S[^\r\n]*$/).optional(),
});

// 창 없는 사람 결정. 기능 화면(문제 결정, 앱 rewind, 파일 지움, provider 연결)에서 누르면
// renderer가 shell main에 handle을 청한다. shell main이 정본을 다시 읽어 core에 handle을 등록해
// 참조만 돌려주고, renderer는 그 handle로 `confirmation: required` route를 부른다.
// 요청은 owner_decision 참조와 같은 칸이고 원문은 통로에 지나지 않는다.
export const decisionHandleRequestSchema = ownerDecisionIntentSchema.omit({
  kind: true,
});

export type DecisionHandleRequest = z.infer<typeof decisionHandleRequestSchema>;

export const decisionHandleResultSchema = z.union([
  z.strictObject({
    confirmation: confirmationRefSchema,
    expires_at: atSchema,
  }),
  errorBodySchema,
]);

export type DecisionHandleResult = z.infer<typeof decisionHandleResultSchema>;

// 창 없는 사람 결정의 handle을 청하는 shell 통로.
export type LophnShell = {
  requestDecisionHandle(
    request: DecisionHandleRequest,
  ): Promise<DecisionHandleResult>;
};
