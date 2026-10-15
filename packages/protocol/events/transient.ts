import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { pendingApprovalSchema } from "../approvals/mod.ts";
import { eventTypeSchema } from "../base/event.ts";

// 남지 않는 event는 session 밖에서 화면만 알면 되는 일이다. 메모리로만 흐르고 Ledger에 쓰지 않는다.
// 놓쳐도 그 대상은 표에 남아 있어 snapshot으로 맞춘다.

export type TransientEventDefinition<
  T extends string = string,
  S extends z.ZodType = z.ZodType,
  P extends z.ZodType = z.ZodType,
> = { type: T; subject: S; payload: P };

function defineTransientEvent<
  T extends string,
  S extends z.ZodType,
  P extends z.ZodType,
>(
  type: T,
  definition: { subject: S; payload: P },
): TransientEventDefinition<T, S, P> {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new Error("event type must be <Entity><과거형 동사> PascalCase");
  }
  return { type, subject: definition.subject, payload: definition.payload };
}

export function transientEventEnvelopeSchema<
  D extends TransientEventDefinition,
>(definition: D) {
  return z.object({
    type: z.literal(definition.type),
    subject: definition.subject,
    at: atSchema,
    payload: definition.payload,
  });
}

// 보류 request를 표에 쓰고 commit한 뒤 낸다.
export const approvalRequested = defineTransientEvent("ApprovalRequested", {
  subject: idSchema("apr"),
  payload: z.strictObject({ request: pendingApprovalSchema }),
});

// activation, 앱 grant 바뀜, 앱 rewind가 끝난 뒤 낸다. 열린 앱 view가 다시 그린다.
export const appViewChanged = defineTransientEvent("AppViewChanged", {
  subject: idSchema("app"),
  payload: z.strictObject({
    reason: z.enum(["activation", "grant", "rewind"]),
  }),
});

// core가 설정 파일 바뀜을 보고 낸다. 쓰는 요소가 값을 다시 읽는 신호다.
export const settingsChanged = defineTransientEvent("SettingsChanged", {
  subject: z.null(),
  payload: z.strictObject({ keys: z.array(z.string().min(1)) }),
});

export const TRANSIENT_EVENTS = [
  approvalRequested,
  appViewChanged,
  settingsChanged,
] as const;

export type TransientEventType = (typeof TRANSIENT_EVENTS)[number]["type"];

export const transientEventSchema = z.discriminatedUnion("type", [
  transientEventEnvelopeSchema(approvalRequested),
  transientEventEnvelopeSchema(appViewChanged),
  transientEventEnvelopeSchema(settingsChanged),
]);
export type TransientEvent = z.infer<typeof transientEventSchema>;
