import { z } from "zod";
import { withReadCommon } from "./envelope.ts";
import { defineEvent, eventTypeSchema } from "./events.ts";
import { idSchema } from "./ids.ts";
import { defineCommand, defineMemory, defineRead } from "./route.ts";
import { atSchema, seqSchema } from "./values.ts";

export const notificationSchema = z.object({
  id: idSchema("ntf"),
  source_seq: seqSchema,
  read_at: atSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

// 계기 표는 source event 이름과 생성 조건만 적는다(architecture/platform 5.10).
// payload type은 소유 contracts가 나중에 준다. 아직 없는 event는 이름 문자열만 쓴다.
export const NOTIFICATION_TRIGGERS = [
  {
    event: "ProblemOpened",
    owner: "problems/grouping",
    condition: "operational_report",
  },
  {
    event: "ProblemReopened",
    owner: "problems/grouping",
    condition: "operational_report",
  },
  {
    event: "ProblemClosed",
    owner: "problems/closing",
    condition: "operational_report",
  },
  {
    event: "ApprovalRequestCreated",
    owner: "platform/approvals",
    condition: "always",
  },
  {
    event: "QuestionCreated",
    owner: "lophn-agent/questions",
    condition: "always",
  },
  {
    event: "TicketConfirmed",
    owner: "coding-agent/tickets",
    condition: "always",
  },
  {
    event: "TicketCheckFailed",
    owner: "coding-agent/tickets",
    condition: "always",
  },
  {
    event: "AssignmentPaused",
    owner: "lophn-agent/assignments",
    condition: "machine_repeated_failure_or_archived_target",
  },
  {
    event: "ReleaseActivationFailed",
    owner: "apps/releases",
    condition: "always",
  },
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

const triggerEventSchema = z.enum(
  NOTIFICATION_TRIGGERS.map((trigger) => trigger.event),
);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// OS 표시 실패 이유는 이 고정 값뿐이다. OS 원문 오류는 wire에 실리지 않는다.
export const OS_DELIVERY_FAILURE_REASONS = [
  "unsupported",
  "show_failed",
] as const;
export const osDeliveryFailureReasonSchema = z.enum(
  OS_DELIVERY_FAILURE_REASONS,
);
export type OsDeliveryFailureReason = z.infer<
  typeof osDeliveryFailureReasonSchema
>;

// 조회에 붙는 OS 전달 상태다(platform/notifications#R10). ledger 상태가 아니라 core 메모리의
// 관측이다. "delivered"는 없다: 배달 성공은 보장하지 않는다. not_requested는 사람이 켜지
// 않은 것, unconfirmed는 켰지만 이 실행에서 실패 관측이 없는 것이다(재시작 뒤 포함).
export const osDeliverySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not_requested") }),
  z.strictObject({ state: z.literal("unconfirmed") }),
  z.strictObject({
    state: z.literal("failed"),
    reason: osDeliveryFailureReasonSchema,
    observed_at: atSchema,
  }),
]);
export type OsDelivery = z.infer<typeof osDeliverySchema>;

export const notificationsGetInputSchema = z.strictObject({
  notification: idSchema("ntf"),
});
// 사람 줄이 source event에서 읽는 당시 시각이다(platform/notifications#R3). payload 자체는 없다.
const notificationLineSchema = {
  occurred_at: atSchema.optional(),
};

export const notificationsGetOutputSchema = withReadCommon(z.object({
  notification: notificationSchema,
  source_event: eventTypeSchema,
  ...notificationLineSchema,
  delivery: osDeliverySchema.optional(),
}));
export const notificationsGet = defineRead({
  resource: "notifications",
  method: "get",
  name: "GetNotification",
  input: notificationsGetInputSchema,
  output: notificationsGetOutputSchema,
  actors: ["user", "machine"],
  errors: readErrors,
});

export const notificationsListInputSchema = z.strictObject({
  unread_only: z.boolean().optional(),
  after_source_seq: seqSchema.optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const notificationsListOutputSchema = withReadCommon(z.object({
  notifications: z.array(z.object({
    notification: notificationSchema,
    source_event: eventTypeSchema,
    ...notificationLineSchema,
    delivery: osDeliverySchema.optional(),
  })),
}));
export const notificationsList = defineRead({
  resource: "notifications",
  method: "list",
  name: "ListNotifications",
  input: notificationsListInputSchema,
  output: notificationsListOutputSchema,
  actors: ["user", "machine"],
  errors: readErrors,
});

export const createNotificationInputSchema = z.strictObject({
  id: idSchema("ntf"),
  source_seq: seqSchema,
  source_event: triggerEventSchema,
  processed_through_seq: seqSchema,
  // cursor CAS가 자기 구독자를 input에서 읽는다(events advance-cursor와 같은 모양).
  subscriber: z.literal("notifications"),
});
export const createNotificationOutputSchema = z.object({
  notification: notificationSchema,
  replayed: z.boolean(),
});
// 생성은 이 concern의 전용 machine 구독자만 낸다.
export const createNotification = defineCommand({
  resource: "notifications",
  method: "create",
  name: "create_notification",
  input: createNotificationInputSchema,
  output: createNotificationOutputSchema,
  compare: z.strictObject({ processed_through_seq: seqSchema }),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "invalid_input", "conflict"],
});

export const markNotificationReadInputSchema = z.strictObject({
  notification: idSchema("ntf"),
});
export const markNotificationReadOutputSchema = z.object({
  notification: notificationSchema,
  changed: z.boolean(),
});
export const markNotificationRead = defineCommand({
  resource: "notifications",
  method: "read",
  name: "mark_notification_read",
  input: markNotificationReadInputSchema,
  output: markNotificationReadOutputSchema,
  actors: ["user"],
  errors: ["forbidden", "not_found"],
});

// shell main이 OS에 올릴 때 받는 전부다(platform/notifications#R9). 사람이 켰을 때만 값이 있고,
// 제목은 redaction을 거친 계기 종류, 열 곳은 대상 하나의 참조다. focus·이동 필드는 없다(R12).
export const osDisplaySchema = z.strictObject({
  notification: idSchema("ntf"),
  title: z.strictObject({ kind: z.string() }),
  open: z.strictObject({ kind: z.string(), id: z.string() }).nullable(),
});
export type OsDisplay = z.infer<typeof osDisplaySchema>;

export const notificationsDisplayInputSchema = z.strictObject({
  notification: idSchema("ntf"),
});
export const notificationsDisplayOutputSchema = withReadCommon(z.object({
  display: osDisplaySchema.nullable(),
}));
// 없는 notification과 범위 밖 호출자는 같은 not_found다.
export const notificationsDisplay = defineRead({
  resource: "notifications",
  method: "display",
  name: "notification.os_display",
  input: notificationsDisplayInputSchema,
  output: notificationsDisplayOutputSchema,
  actors: ["user"],
  errors: readErrors,
});

export const reportOsDeliveryInputSchema = z.strictObject({
  notification: idSchema("ntf"),
  reason: osDeliveryFailureReasonSchema,
});
export const reportOsDeliveryOutputSchema = z.object({});
// shell main이 OS 표시 실패를 알린다. ledger를 쓰지 않는 core 메모리 route다: event·표·재시도
// 상태를 만들지 않는다. 고정 이유만 받고 원문 오류는 schema가 거절한다(invalid_input).
export const reportOsDelivery = defineMemory({
  resource: "notifications",
  method: "delivery",
  name: "notification.os_delivery_failed",
  input: reportOsDeliveryInputSchema,
  output: reportOsDeliveryOutputSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const NOTIFICATION_ROUTES = [
  notificationsGet,
  notificationsList,
  createNotification,
  markNotificationRead,
  notificationsDisplay,
  reportOsDelivery,
] as const;

const notificationSubject = idSchema("ntf");

export const notificationCreatedPayloadSchema = z.object({
  source_seq: seqSchema,
});
export const notificationReadPayloadSchema = z.object({ read_at: atSchema });

export const notificationCreated = defineEvent("NotificationCreated", {
  subject: notificationSubject,
  payload: notificationCreatedPayloadSchema,
});
export const notificationRead = defineEvent("NotificationRead", {
  subject: notificationSubject,
  payload: notificationReadPayloadSchema,
});

export const NOTIFICATION_EVENTS = [
  notificationCreated,
  notificationRead,
] as const;
