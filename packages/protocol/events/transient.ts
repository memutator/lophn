import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { eventTypeSchema } from "../base/event.ts";
import { acpUpdatedPayloadSchema } from "../acp/routes.ts";
import { noticeSchema } from "../apps/notice.ts";
import { appViewEventPayloadSchema } from "../apps/views.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { CHANGE_NAMES } from "./changes.ts";

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

// sync 앱의 sync log에 줄이 생겼다(컴퓨터의 write, 폰에서 온 변경, rewind, '다시 snapshot'). 폰이 `app_sync/pull`한다.
const appSyncChanged = defineTransientEvent("AppSyncChanged", {
  subject: idSchema("app"),
  payload: z.strictObject({
    release: idSchema("rel"),
    seq: z.number().int().nonnegative(),
  }),
});

// 앱을 영구히 지운 command(app.delete)가 commit된 뒤 낸다. 지운 앱을 가리키던 shell 쪽 자리(browser 저장소, layout, 전역 float)를 정리한다.
const appRemoved = defineTransientEvent("AppRemoved", {
  subject: idSchema("app"),
  payload: z.strictObject({}),
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

// 앱 공유 요청이 표에 쓰이고 commit된 뒤 낸다. subject는 앱이다(앱마다 열린 요청은 하나이고 새 요청이 대신해도 낸다).
const shareRequestOpened = defineTransientEvent("ShareRequestOpened", {
  subject: idSchema("app"),
  payload: z.strictObject({
    app: idSchema("app"),
    app_name: z.string().min(1),
  }),
});

// job의 놓친 차례가 새 held 줄로 commit된 뒤 낸다(이미 있는 held 줄이 갱신될 때는 내지 않는다). subject는 job이다.
// 사람이 [Start now]를 정하길 기다리는 일이라 push의 계기가 된다. Inbox는 `StateChanged{jobs}`로 다시 읽으므로 폰 allowlist에는 없다.
const jobHeld = defineTransientEvent("JobHeld", {
  subject: idSchema("job"),
  payload: z.strictObject({
    job: idSchema("job"),
    run: idSchema("jbr"),
    job_title: z.string().min(1),
  }),
});

// 사람이 정해 앱 공유 요청이 닫힌 뒤 낸다.
const shareRequestClosed = defineTransientEvent("ShareRequestClosed", {
  subject: idSchema("app"),
  payload: z.strictObject({
    app: idSchema("app"),
    outcome: z.enum(["approve", "reject"]),
  }),
});

// notice 행이 표에 쓰이고 commit된 뒤 낸다. subject는 앱(앱에 관한 행이 아니면 null)이다. 같은 key의 행이 다시 와도 낸다(id는 같다).
// payload가 행 한 건이라 화면은 다시 읽지 않고 toast와 Inbox 줄을 만든다.
const noticePosted = defineTransientEvent("NoticePosted", {
  subject: idSchema("app").nullable(),
  payload: noticeSchema,
});

// 휘발 행을 사람이 지웠거나 앱당 상한·앱 보관으로 행이 표에서 빠진 뒤 낸다. 같은 key의 교체는 id가 같아 Posted만 낸다.
const noticeClosed = defineTransientEvent("NoticeClosed", {
  subject: idSchema("app").nullable(),
  payload: z.strictObject({ id: idSchema("ntc") }),
});

// 영구 행이 읽음이 된 뒤 낸다. 행은 표에 남고 화면의 열린 줄에서만 빠진다.
const noticeRead = defineTransientEvent("NoticeRead", {
  subject: idSchema("app").nullable(),
  payload: z.strictObject({ id: idSchema("ntc"), read_at: atSchema }),
});

// 앱(또는 core)이 event를 낸 뒤 낸다. 열린 앱 화면 가운데 구독을 선언한 화면이 받는다. 앱 process의 구독자는 core가 앱 호출로 직접
// 부르므로 이 event를 거치지 않는다. subject는 발행한 앱이고 core가 낸 event(`source` `lophn`)면 null이다.
// payload는 발행 앱이 선언한 schema를 통과한 값이다(저장하지 않는다).
const appEventPublished = defineTransientEvent("AppEventPublished", {
  subject: idSchema("app").nullable(),
  payload: z.strictObject({
    // 발행 앱의 slug이거나 `lophn`. 구독 선언의 source와 같은 이름이다.
    source: z.string().min(1),
    event: z.string().min(1),
    payload: jsonValueSchema,
    // 이 앱들의 화면만 받는다. null이면 구독을 선언한 모든 화면이다(core가 내는 event는 앱이 볼 수 있는 것만 싣는다).
    audience: z.array(idSchema("app")).nullable(),
  }),
});

// core의 view 표(`app_views/*`)가 view 하나에 낸다. subject는 그 view의 앱이다. 묶인 release가 구독한 앱 event(`event`),
// 다시 묶음(`rebound`), 묶지 못함(`lost`)이다. Gateway는 payload의 owner가 그 session의 owner일 때만 보낸다.
const appViewEvent = defineTransientEvent("AppViewEvent", {
  subject: idSchema("app"),
  payload: appViewEventPayloadSchema,
});

// ACP 갱신 하나. envelope의 session이 구독 조건(`{session}`)에 걸린다. 화면은 그 session의 갱신을 `reduceAcp`로 접는다.
// payload의 session은 앱 화면으로 가는 IPC 값(`{session, update}`)이 그대로 쓴다.
const acpUpdated = defineTransientEvent("AcpUpdated", {
  subject: z.null(),
  payload: acpUpdatedPayloadSchema,
});

// 상태를 바꾸는 route(와 route 밖에서 상태를 바꾸는 core)가 commit 뒤 낸다. 내용은 싣지 않는다. 화면은 자기가 읽는
// 이름이 있으면 다시 읽는다. id가 null이면 그 이름 전체다. 같은 {name, id}는 한 번만 싣는다.
const stateChanged = defineTransientEvent("StateChanged", {
  subject: z.null(),
  payload: z.strictObject({
    changes: z
      .array(
        z.strictObject({
          name: z.enum(CHANGE_NAMES),
          id: z.string().min(1).nullable(),
        }),
      )
      .min(1),
  }),
});

// 보는 중인 터미널의 화면이 바뀐 뒤 낸다. 내용은 싣지 않고 폰이 `terminal_view/snapshot`을 다시 읽는다. subject는 `terminal:<터미널 탭 참조>`다.
const terminalScreenChanged = defineTransientEvent("TerminalScreenChanged", {
  subject: z.string().regex(/^terminal:.+$/),
  payload: z.strictObject({
    terminal: z.string().min(1),
    seq: z.number().int().min(0),
  }),
});

export const transientEventSchema = z.discriminatedUnion("type", [
  transientEventEnvelopeSchema(acpUpdated).extend({
    session: idSchema("ses"),
  }),
  transientEventEnvelopeSchema(appViewChanged),
  transientEventEnvelopeSchema(appRemoved),
  transientEventEnvelopeSchema(appSyncChanged),
  transientEventEnvelopeSchema(appRestartHalted),
  transientEventEnvelopeSchema(activationConsentRequested),
  transientEventEnvelopeSchema(activationConsentClosed),
  transientEventEnvelopeSchema(shareRequestOpened),
  transientEventEnvelopeSchema(shareRequestClosed),
  transientEventEnvelopeSchema(jobHeld),
  transientEventEnvelopeSchema(noticePosted),
  transientEventEnvelopeSchema(noticeClosed),
  transientEventEnvelopeSchema(noticeRead),
  transientEventEnvelopeSchema(appEventPublished),
  transientEventEnvelopeSchema(appViewEvent),
  transientEventEnvelopeSchema(stateChanged),
  transientEventEnvelopeSchema(terminalScreenChanged),
]);
