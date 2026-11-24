import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { eventTypeSchema } from "../base/event.ts";
import { acpUpdatedPayloadSchema } from "../acp/routes.ts";
import { noticeSchema } from "../apps/notice.ts";
import { appViewEventPayloadSchema } from "../apps/views.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { hookResultSchema } from "../coding-agent/coding-agents.ts";
import {
  terminalOutputSchema,
  terminalProjectSchema,
  terminalRuntimeSchema,
} from "../coding-agent/terminals.ts";
import { terminalScreenDiffSchema } from "../coding-agent/terminal-view.ts";
import { traceIdSchema } from "../apps/calls/caller.ts";
import { APP_CALL_DEPTH_LIMIT } from "../apps/channel-values.ts";
import { appIdSchema } from "../projects/values.ts";
import { projectCommandRunSchema } from "../projects/project-commands.ts";
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

// project의 workflow 폴더 이름을 바꾼 뒤 낸다. 열린 project 창이 desk key를 따라 바꾸어 Main으로 합쳐지지 않게 한다.
const workflowRenamed = defineTransientEvent("WorkflowRenamed", {
  subject: idSchema("prj"),
  payload: z.strictObject({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
});

// project의 workflow를 지운 뒤 낸다. 열린 project 창이 workflow 탭·desk를 정리한다.
const workflowRemoved = defineTransientEvent("WorkflowRemoved", {
  subject: idSchema("prj"),
  payload: z.strictObject({
    name: z.string().min(1),
  }),
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
    // 이 발행의 기록 id, trace, 인과의 앱들. 다른 컴퓨터가 이 event를 받아 구독자를 부를 때 event caller에 그대로 싣는다.
    publication: idSchema("pub"),
    trace_id: traceIdSchema,
    chain: z.array(appIdSchema).max(APP_CALL_DEPTH_LIMIT),
    // `across_machines` event를 낸 기계가 event file에 붙인 id(ULID. `eventFileSchema.id`와 같은 꼴이다. protocol/remote를 import하면 순환이다). 받는 기계가 연결로 온 것과 늦게 닿는 file을 같은 event로 센다.
    cross_id: z
      .string()
      .regex(/^[0-7][0-9a-hjkmnp-tv-z]{25}$/)
      .optional(),
    // 다른 컴퓨터가 낸 call이나 다른 컴퓨터에서 온 event가 부른 호출 안에서 난 event다. 이 기계에만 있고 다른 컴퓨터로 나가지 않는다(두 컴퓨터 사이 고리를 끊는다).
    remote: z.literal(true).optional(),
    // 다른 기계에서 와 이 기계가 낸 event면 그 난 기계. 이 기계가 낸 event만 다른 컴퓨터에 나가므로 되돌려 나르지 않는 표시다.
    machine: idSchema("mch").optional(),
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

// 터미널 event의 subject는 `terminal:<터미널 참조>`다.
const terminalSubjectSchema = z.string().regex(/^terminal:.+$/);

// 보는 중인 터미널의 화면이 바뀐 뒤 낸다. 바뀐 것이 작으면 바로 앞 화면(`diff.base_seq`)에서 바뀐 줄과 커서를 `diff`로 싣는다. `diff`가 없거나
// 보는 쪽의 마지막 seq가 `base_seq`가 아니면 보는 쪽이 `terminal_view/snapshot`을 다시 읽는다. subject는 `terminal:<터미널 탭 참조>`다.
const terminalScreenChanged = defineTransientEvent("TerminalScreenChanged", {
  subject: terminalSubjectSchema,
  payload: z.strictObject({
    terminal: z.string().min(1),
    seq: z.number().int().min(0),
    diff: terminalScreenDiffSchema.optional(),
  }),
});

// 보는 중인 browser 탭의 frame이나 상태(그리는가, take control, url·title)가 바뀐 뒤 낸다. 내용은 싣지 않고 보는 쪽이
// `page_view/snapshot`을 다시 읽는다. subject는 `page:<탭 id>`다.
const pageViewChanged = defineTransientEvent("PageViewChanged", {
  subject: z.string().regex(/^page:tab_.+$/),
  payload: z.strictObject({
    tab: idSchema("tab"),
    seq: z.number().int().min(0),
  }),
});

// agent가 `tab show`로 자기 browser 탭을 사람에게 폈다. 그 기계의 창은 host link의 tab_show로 펴고, 그 session을 다른 컴퓨터에서
// 보는 창은 이 event로 그 page의 원격 보기 탭을 연다. 화면 없는 기계에서는 이 길만 사람에게 닿는다.
const tabShowRequested = defineTransientEvent("TabShowRequested", {
  subject: idSchema("ses"),
  payload: z.strictObject({ tab: idSchema("tab") }),
});

// `machines/watch`로 건 다른 기계의 Gateway frame 하나를 이 컴퓨터의 bus에 싣는다. subject는 `machine:<mch_>`다.
// `event`를 bus event schema로 적지 않는 것은 이 file → gateway → bus → 이 file의 순환 때문이다. 받는 쪽(shell main)이
// bus event schema로 읽는다. 기기 event 목록(REMOTE_ALLOWED_EVENTS)에 넣지 않는다: 다른 기계의 내용이 폰에 그대로 가지 않게 한다.
const machineFrameReceived = defineTransientEvent("MachineFrameReceived", {
  subject: z.string().regex(/^machine:mch_.+$/),
  payload: z.strictObject({
    machine: idSchema("mch"),
    frame: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("ready") }),
      z.strictObject({ type: z.literal("event"), event: jsonValueSchema }),
      z.strictObject({
        type: z.literal("closed"),
        reason: z.enum(["slow_consumer", "credential_revoked", "shutdown"]),
      }),
    ]),
    // 한 구독자가 바꾼 합에 그 기계가 답한 `ready`만 그 구독자의 `watcher`를 단다. 없는 `ready`는 모든 구독자의 것이다.
    watcher: z.string().min(1).max(64).optional(),
  }),
});

// 터미널의 날 출력 한 조각(host가 묶은 chunk 하나). 그 터미널에 `terminals/watch` lease가 하나라도 있는 동안만 낸다. 받는 쪽은 받은
// seq보다 큰 것만 쓰고, seq가 건너뛰거나 Gateway가 다시 열리면 `terminals/snapshot{after_seq}`로 맞춘다. core는 터미널마다 queue를
// 두지 않는다(느린 화면은 Gateway가 끊는다).
const terminalOutputAppended = defineTransientEvent("TerminalOutputAppended", {
  subject: terminalSubjectSchema,
  payload: terminalOutputSchema,
});

// 터미널 runtime이 바뀔 때마다 낸다(열림, 끝, 다시 띄움, 크기, agent, 탭 이름). lease와 상관없다.
const terminalRuntimeChanged = defineTransientEvent("TerminalRuntimeChanged", {
  subject: terminalSubjectSchema,
  payload: z.strictObject({ runtime: terminalRuntimeSchema }),
});

// 터미널의 coding agent가 사람에게 알릴 계기(권한 물음, 일 끝, 실패)를 tracker가 정한 순간 낸다. 보고 있는지는 보지 않고 늘 낸다.
// shell main이 이것으로 toast·OS 알림을 고른다. name은 탭 이름(모르면 null), body는 hook이 준 글(마지막 답, 물음 요약, 실패 글)이다.
const terminalAgentSignaled = defineTransientEvent("TerminalAgentSignaled", {
  subject: terminalSubjectSchema,
  payload: z.strictObject({
    terminal: z.string().min(1),
    project: terminalProjectSchema,
    harness: z.string().min(1),
    kind: z.enum(["waiting", "finished", "failed"]),
    name: z.string().nullable(),
    body: z.string().nullable(),
  }),
});

// 자동 hook 설치가 끝났다.
const hookInstallFinished = defineTransientEvent("HookInstallFinished", {
  subject: z.null(),
  payload: hookResultSchema,
});

// project의 명령 정의나 agent 설정이 바뀌었다. subject는 project id다.
const projectCommandsChanged = defineTransientEvent("ProjectCommandsChanged", {
  subject: idSchema("prj"),
  payload: z.strictObject({
    project: idSchema("prj"),
  }),
});

// project command 실행 상태(시작, URL 감지, 종료 등)가 바뀌었다. subject는 project id다.
const projectCommandRunChanged = defineTransientEvent(
  "ProjectCommandRunChanged",
  {
    subject: idSchema("prj"),
    payload: z.strictObject({
      project: idSchema("prj"),
      run: projectCommandRunSchema,
    }),
  },
);

export const transientEventSchema = z.discriminatedUnion("type", [
  transientEventEnvelopeSchema(acpUpdated).extend({
    session: idSchema("ses"),
  }),
  transientEventEnvelopeSchema(appViewChanged),
  transientEventEnvelopeSchema(appRemoved),
  transientEventEnvelopeSchema(workflowRenamed),
  transientEventEnvelopeSchema(workflowRemoved),
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
  transientEventEnvelopeSchema(pageViewChanged),
  transientEventEnvelopeSchema(tabShowRequested),
  transientEventEnvelopeSchema(machineFrameReceived),
  transientEventEnvelopeSchema(terminalOutputAppended),
  transientEventEnvelopeSchema(terminalRuntimeChanged),
  transientEventEnvelopeSchema(terminalAgentSignaled),
  transientEventEnvelopeSchema(hookInstallFinished),
  transientEventEnvelopeSchema(projectCommandsChanged),
  transientEventEnvelopeSchema(projectCommandRunChanged),
]);
