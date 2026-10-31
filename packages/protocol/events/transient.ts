import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { eventTypeSchema } from "../base/event.ts";
import { workflowNameSchema } from "../workflows/values.ts";

// 남지 않는 event는 session 밖에서 화면만 알면 되는 일이다. 메모리로만 흐르고 Ledger에 쓰지 않는다.
// 놓쳐도 그 대상은 표에 남아 있어 snapshot으로 맞춘다.

type TransientEventDefinition<
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

function transientEventEnvelopeSchema<
  T extends string,
  S extends z.ZodType,
  P extends z.ZodType,
>(definition: TransientEventDefinition<T, S, P>) {
  return z.object({
    type: z.literal(definition.type),
    subject: definition.subject,
    at: atSchema,
    payload: definition.payload,
  });
}

// activation, 앱 grant 바뀜, 앱 rewind가 끝난 뒤 낸다. 열린 앱 view가 다시 그린다.
const appViewChanged = defineTransientEvent("AppViewChanged", {
  subject: idSchema("app"),
  payload: z.strictObject({
    reason: z.enum(["activation", "grant", "rewind"]),
  }),
});

// core가 설정 파일 바뀜을 보고 낸다. 쓰는 요소가 값을 다시 읽는 신호다.
const settingsChanged = defineTransientEvent("SettingsChanged", {
  subject: z.null(),
  payload: z.strictObject({ keys: z.array(z.string().min(1)) }),
});

// crash loop 기록이 commit된 뒤 core가 낸다. 사람에게 앱이 멈췄다고 알리는 toast만 듣는다.
const appRestartHalted = defineTransientEvent("AppRestartHalted", {
  subject: idSchema("app"),
  payload: z.strictObject({
    // toast가 id 대신 보일 앱 이름.
    app_name: z.string().min(1),
    release: idSchema("rel"),
    crashes: z.number().int().min(1),
  }),
});

// 동의 대기가 표에 쓰이고 commit된 뒤 낸다. subject는 release다(같은 release는 동의 줄 하나).
const activationConsentRequested = defineTransientEvent(
  "ActivationConsentRequested",
  {
    subject: idSchema("rel"),
    payload: z.strictObject({
      app: idSchema("app"),
      app_name: z.string().min(1),
      release: idSchema("rel"),
    }),
  },
);

// 사람이 정했거나 더 새 release가 시작해 동의 대기가 닫힌 뒤 낸다.
const activationConsentClosed = defineTransientEvent(
  "ActivationConsentClosed",
  {
    subject: idSchema("rel"),
    payload: z.strictObject({
      app: idSchema("app"),
      release: idSchema("rel"),
      outcome: z.enum(["allow", "reject", "cancelled"]),
    }),
  },
);

// kinds dispatcher가 앞 sync에 없던 위반을 볼 때 낸다. count는 그 새 위반 수다.
const kindViolationFound = defineTransientEvent("KindViolationFound", {
  subject: idSchema("dom"),
  payload: z.strictObject({
    domain: idSchema("dom"),
    count: z.number().int().min(1),
  }),
});

// instance 행이나 줄이 바뀐 command가 commit된 뒤 한 번 낸다. 화면과 artifact view가 다시 읽으라는 신호다.
// CLI로 낸 report는 session event가 없어 화면이 알 길이 이것뿐이다. 정의 file이 바뀐 것은 알리지 않는다.
const workflowInstanceChanged = defineTransientEvent(
  "WorkflowInstanceChanged",
  {
    subject: idSchema("wfi"),
    payload: z.strictObject({
      project: idSchema("prj"),
      workflow: workflowNameSchema,
    }),
  },
);

// job이나 job run이 바뀐 command가 commit된 뒤 낸다. 대기 목록과 job 화면이 다시 읽으라는 신호다.
// run과 instance 줄은 지금의 session event와 WorkflowInstanceChanged 때 다시 읽으므로 따로 알리지 않는다.
const jobChanged = defineTransientEvent("JobChanged", {
  subject: idSchema("job"),
  payload: z.strictObject({ job_run: idSchema("jbr").nullable() }),
});

export const transientEventSchema = z.discriminatedUnion("type", [
  transientEventEnvelopeSchema(appViewChanged),
  transientEventEnvelopeSchema(settingsChanged),
  transientEventEnvelopeSchema(appRestartHalted),
  transientEventEnvelopeSchema(kindViolationFound),
  transientEventEnvelopeSchema(activationConsentRequested),
  transientEventEnvelopeSchema(activationConsentClosed),
  transientEventEnvelopeSchema(workflowInstanceChanged),
  transientEventEnvelopeSchema(jobChanged),
]);
