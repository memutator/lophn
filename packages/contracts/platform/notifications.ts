import { z } from "zod";
import { withReadCommon } from "./envelope.ts";
import { defineEvent, eventTypeSchema } from "./events.ts";
import { idSchema } from "./ids.ts";
import { defineCommand, defineRead } from "./route.ts";
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
    event: "ContextWatchedItemChanged",
    owner: "documents/contexts",
    condition: "machine_watch_change_or_section_loss",
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

export const notificationsGetInputSchema = z.strictObject({
  notification: idSchema("ntf"),
});
export const notificationsGetOutputSchema = withReadCommon(z.object({
  notification: notificationSchema,
  source_event: eventTypeSchema,
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

export const NOTIFICATION_ROUTES = [
  notificationsGet,
  notificationsList,
  createNotification,
  markNotificationRead,
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
