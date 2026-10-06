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
  notificationsDisplay,
  notificationsGet,
  notificationsList,
  osDeliverySchema,
  osDisplaySchema,
  reportOsDelivery,
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
      ["read", "/v1/notifications/display"],
      ["memory", "/v1/notifications/delivery"],
    ],
  );
  assertEquals(NOTIFICATION_ROUTES.map((route) => route.name), [
    "GetNotification",
    "ListNotifications",
    "create_notification",
    "mark_notification_read",
    "notification.os_display",
    "notification.os_delivery_failed",
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
      subscriber: "notifications",
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
      subscriber: "notifications",
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
  // cursor CAS는 notifications 구독자만 읽는다. 다른 구독자·빠진 구독자는 거절이다.
  assert(
    !createNotificationInputSchema.safeParse({
      id: NTF,
      source_seq: "42",
      source_event: "QuestionCreated",
      processed_through_seq: "42",
      subscriber: "notes",
    }).success,
  );
});

Deno.test("platform/notifications#R10: delivery는 고정 상태 셋뿐이고 delivered와 원문 이유가 없다", () => {
  const at = "2026-10-06T00:00:00.000Z";
  assert(osDeliverySchema.safeParse({ state: "not_requested" }).success);
  assert(osDeliverySchema.safeParse({ state: "unconfirmed" }).success);
  assert(
    osDeliverySchema.safeParse({
      state: "failed",
      reason: "show_failed",
      observed_at: at,
    }).success,
  );
  for (
    const bad of [
      { state: "delivered" },
      { state: "failed", reason: "dbus: ENOENT /home/me", observed_at: at },
      { state: "failed", reason: "show_failed" },
      { state: "unconfirmed", reason: "show_failed" },
    ]
  ) {
    assert(!osDeliverySchema.safeParse(bad).success);
  }
});

Deno.test("platform/notifications#R10: get·list 출력의 delivery는 선택 필드다(옛 응답도 통과)", () => {
  const item = { notification, source_event: "QuestionCreated" };
  const common = { as_of_seq: "42", next_cursor: null };
  assert(
    notificationsGet.output.safeParse({ ...item, ...common }).success,
  );
  assert(
    notificationsGet.output.safeParse({
      ...item,
      ...common,
      delivery: { state: "unconfirmed" },
    }).success,
  );
  assert(
    notificationsList.output.safeParse({
      notifications: [{ ...item, delivery: { state: "not_requested" } }, item],
      ...common,
    }).success,
  );
  assert(
    !notificationsGet.output.safeParse({
      ...item,
      ...common,
      delivery: { state: "delivered" },
    }).success,
  );
});

Deno.test("platform/notifications#R9, R12: OS 표시 요청은 제목 종류와 열 곳뿐이고 이동 필드가 없다", () => {
  const display = {
    notification: NTF,
    title: { kind: "QuestionCreated" },
    open: { kind: "question", id: "qst_01arz3ndektsv4rrffq69g5fav" },
  };
  assert(osDisplaySchema.safeParse(display).success);
  assert(osDisplaySchema.safeParse({ ...display, open: null }).success);
  for (
    const extra of [{ focus: true }, { navigate: "doc" }, { body: "원문" }]
  ) {
    assert(!osDisplaySchema.safeParse({ ...display, ...extra }).success);
  }
  assert(
    notificationsDisplay.output.safeParse({
      display: null,
      as_of_seq: "1",
      next_cursor: null,
    }).success,
  );
  assertEquals(notificationsDisplay.actors, ["user"]);
});

Deno.test("platform/notifications#R10: 전달 실패 보고 route는 shell(user) 전용 core 메모리 route이고 고정 이유만 받는다", () => {
  assertEquals(reportOsDelivery.kind, "memory");
  assertEquals(reportOsDelivery.actors, ["user"]);
  assert(
    reportOsDelivery.input.safeParse({
      notification: NTF,
      reason: "show_failed",
    })
      .success,
  );
  for (
    const bad of [
      { notification: NTF, reason: "Error: dbus ENOENT /home/me/.config" },
      { notification: NTF, reason: "" },
      { notification: NTF },
      { notification: NTF, reason: "unsupported", detail: "x" },
      { notification: "not-an-id", reason: "unsupported" },
    ]
  ) {
    assert(!reportOsDelivery.input.safeParse(bad).success);
  }
});
