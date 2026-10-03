import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "./events.ts";
import { routePath } from "./route.ts";
import {
  createNotificationInputSchema,
  NOTIFICATION_EVENTS,
  NOTIFICATION_ROUTES,
  NOTIFICATION_TRIGGERS,
  notificationSchema,
} from "./notifications.ts";

const NTF = "ntf_01arz3ndektsv4rrffq69g5fav";
const notification = {
  id: NTF,
  source_seq: "42",
  read_at: null,
};

Deno.test("platform/notifications#R1, platform/notifications#R5: route와 event 이름은 architecture 5.1·5.10과 같다", () => {
  assertEquals(
    NOTIFICATION_ROUTES.map((route) => [route.kind, routePath(route)]),
    [
      ["read", "/v1/notifications/get"],
      ["read", "/v1/notifications/list"],
      ["command", "/v1/notifications/create"],
      ["command", "/v1/notifications/read"],
    ],
  );
  assertEquals(NOTIFICATION_ROUTES.map((route) => route.name), [
    "GetNotification",
    "ListNotifications",
    "create_notification",
    "mark_notification_read",
  ]);
  assertEquals(NOTIFICATION_EVENTS.map((event) => event.type), [
    "NotificationCreated",
    "NotificationRead",
  ]);
  for (const route of NOTIFICATION_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("platform/notifications#R1, platform/notifications#R2: 계기 표는 source event 이름과 생성 조건만 적는다", () => {
  assertEquals(
    NOTIFICATION_TRIGGERS.map((trigger) => trigger.event),
    [
      "ProblemOpened",
      "ProblemReopened",
      "ProblemClosed",
      "ApprovalRequestCreated",
      "QuestionCreated",
      "TicketConfirmed",
      "TicketCheckFailed",
      "AssignmentPaused",
      "ContextWatchedItemChanged",
      "ReleaseActivationFailed",
    ],
  );
  for (const trigger of NOTIFICATION_TRIGGERS) {
    assertEquals(Object.keys(trigger), ["event", "owner", "condition"]);
  }
  const conditions = NOTIFICATION_TRIGGERS.map((trigger) => trigger.condition);
  assertEquals(
    conditions.filter((condition) => condition === "always").length,
    5,
  );
  assert(!conditions.includes("never" as never));
});

Deno.test("platform/notifications#R3, platform/notifications#R4: 예시 입력이 통과한다", () => {
  assert(notificationSchema.safeParse(notification).success);
  assert(
    notificationSchema.safeParse({
      ...notification,
      read_at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  assert(
    createNotificationInputSchema.safeParse({
      id: NTF,
      source_seq: "42",
      source_event: "QuestionCreated",
      processed_through_seq: "42",
    }).success,
  );
  const envelope = eventEnvelopeSchema(NOTIFICATION_EVENTS[1]);
  assert(
    envelope.safeParse({
      seq: "43",
      type: "NotificationRead",
      subject: NTF,
      actor: "user",
      run: null,
      payload: { read_at: "2026-10-04T00:00:00.000Z" },
      at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
});

Deno.test("platform/notifications#R2, platform/notifications#R4: 모르는 field·틀린 값·틀린 ID 접두사·표 밖 event를 거절한다", () => {
  // 출력 schema는 같은 major의 선택 field 추가를 받아들인다. 입력만 모르는 field를 거절한다.
  assert(notificationSchema.safeParse({ ...notification, body: "x" }).success);
  assert(
    !notificationSchema.safeParse({
      ...notification,
      id: "apr_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !notificationSchema.safeParse({
      ...notification,
      source_seq: "042",
    }).success,
  );
  assert(
    !notificationSchema.safeParse({
      ...notification,
      read_at: "2026-10-04T00:00:00Z",
    }).success,
  );
  assert(
    !createNotificationInputSchema.safeParse({
      id: NTF,
      source_seq: "42",
      source_event: "RunFinished",
      processed_through_seq: "42",
    }).success,
  );
  assert(
    !createNotificationInputSchema.safeParse({
      id: NTF,
      source_seq: "42",
      source_event: "QuestionCreated",
      processed_through_seq: "42",
      channel: "os",
    }).success,
  );
});
