import { z } from "zod";
import { atSchema, sha256Schema } from "./values.ts";

// 발급 시각에서 120초. 실제 기한은 이것과 대상 기한 중 이른 시각이다.
export const CONFIRMATION_HANDLE_TTL_MS = 120_000;

// 원문은 무작위 32 bytes 메모리 값이다. 통로에는 base64url(패딩 없음, 43자) 참조만 지난다.
const CONFIRMATION_REF = /^[A-Za-z0-9_-]{43}$/;

export const confirmationRefSchema = z.string().regex(CONFIRMATION_REF);

export type ConfirmationRef = z.infer<typeof confirmationRefSchema>;

// 소유 contracts가 등록하는 결정 이름. 등록 표는 소유 contracts가 갖는다.
// command route 이름(apps의 grant.revoke처럼 점으로 나뉜 이름)과
// snake_case 선언(delete_file)을 모두 담는다. ledger는 command의 결정 이름을 route.name으로 쓴다.
const DECISION_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

export const decisionNameSchema = z.string().regex(DECISION_NAME);

export type DecisionName = z.infer<typeof decisionNameSchema>;

export function defineDecision(name: string): DecisionName {
  const parsed = decisionNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new Error("decision name must be a command or snake_case name");
  }
  return parsed.data;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// main이 core에 handle 발급을 요청하는 메시지. 기한은 발급 뒤 120초와 대상 기한 중 이른 시각.
export const confirmationHandleRegisterSchema = z.strictObject({
  type: z.literal("confirmation_handle_register"),
  window_id: z.string().min(1),
  target_ref: z.string().min(1),
  content_hash: sha256Schema,
  allowed_decisions: z.array(decisionNameSchema).min(1).refine(unique, {
    message: "duplicate decision",
  }),
  expires_at: atSchema,
});

export type ConfirmationHandleRegister = z.infer<
  typeof confirmationHandleRegisterSchema
>;

// core가 돌려주는 handle 참조. 원문은 응답에 없다.
export const confirmationHandleRegisteredSchema = z.strictObject({
  type: z.literal("confirmation_handle_registered"),
  confirmation: confirmationRefSchema,
  expires_at: atSchema,
});

export type ConfirmationHandleRegistered = z.infer<
  typeof confirmationHandleRegisteredSchema
>;

export const confirmationHandleMessageSchema = z.discriminatedUnion("type", [
  confirmationHandleRegisterSchema,
  confirmationHandleRegisteredSchema,
]);

export type ConfirmationHandleMessage = z.infer<
  typeof confirmationHandleMessageSchema
>;
