import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "./events.ts";
import { routePath } from "./route.ts";
import {
  createNotificationInputSchema,
  NOTIFICATION_ASK_ROLES,
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
      "ReleaseActivationFailed",
      "ContextViolationsRecorded",
    ],
  );
  for (const trigger of NOTIFICATION_TRIGGERS) {
    assertEquals(Object.keys(trigger), [
      "event",
      "owner",
      "condition",
      "ask_agent",
      "first_context",
    ]);
  }
  const conditions = NOTIFICATION_TRIGGERS.map((trigger) => trigger.condition);
  assertEquals(
    conditions.filter((condition) => condition === "always").length,
    5,
  );
  assert(!conditions.includes("never" as never));
  // 사람이 직접 멈춘 assignment는 계기가 아니다: AssignmentPaused는 대상 보관뿐이다.
  assertEquals(
    NOTIFICATION_TRIGGERS.find((trigger) =>
      trigger.event === "AssignmentPaused"
    )
      ?.condition,
    "scope_archived",
  );
});

Deno.test("platform/notifications#R13: 계기 표의 ask_agent는 종류마다 고정이고 앱 문제 둘은 App Engineer, 계약 위반은 Context Engineer다", () => {
  const asks = NOTIFICATION_TRIGGERS.filter((trigger) =>
    trigger.ask_agent !== null
  );
  assertEquals(
    asks.map((trigger) => [trigger.event, trigger.ask_agent]),
    [
      ["ProblemOpened", "app_engineer"],
      ["ReleaseActivationFailed", "app_engineer"],
      ["ContextViolationsRecorded", "context_engineer"],
    ],
  );
  for (const trigger of NOTIFICATION_TRIGGERS) {
    assert(
      trigger.ask_agent === null ||
        NOTIFICATION_ASK_ROLES.includes(trigger.ask_agent),
    );
    // agent가 없으면 첫 context도 없고, 있으면 첫 context가 있다.
    assertEquals(trigger.first_context === null, trigger.ask_agent === null);
  }
  for (
    const event of [
      "ProblemReopened",
      "ProblemClosed",
      "ApprovalRequestCreated",
      "QuestionCreated",
      "TicketConfirmed",
      "TicketCheckFailed",
      "AssignmentPaused",
    ]
  ) {
    const trigger = NOTIFICATION_TRIGGERS.find((item) => item.event === event);
    assertEquals(trigger?.ask_agent, null);
    assertEquals(trigger?.first_context, null);
  }
});

Deno.test("platform/notifications#R14: 첫 context 참조는 앱 자리와 문제 또는 release 대상의 모양이다", () => {
  const byEvent = Object.fromEntries(
    NOTIFICATION_TRIGGERS.map((trigger) => [trigger.event, trigger]),
  );
  assertEquals(byEvent["ProblemOpened"].first_context, {
    work_place: "app",
    target: "problem",
  });
  assertEquals(byEvent["ReleaseActivationFailed"].first_context, {
    work_place: "app",
    target: "release",
  });
  // 계약 위반은 그 context가 속한 project 자리에서 Context Engineer 탭을 열고 context를 첫 context로 붙인다.
  assertEquals(byEvent["ContextViolationsRecorded"].first_context, {
    work_place: "project",
    target: "context",
  });
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

Deno.test("platform/notifications#R3: get·list의 당시 시각은 선택이고 시각이 아니면 거절한다", () => {
  const item = { notification, source_event: "QuestionCreated" };
  const common = { as_of_seq: "42", next_cursor: null };
  const at = "2026-10-04T00:00:00.000Z";
  assert(
    notificationsGet.output.safeParse({
      ...item,
      ...common,
      occurred_at: at,
    }).success,
  );
  assert(
    notificationsList.output.safeParse({
      notifications: [{ ...item, occurred_at: at }, item],
      ...common,
    }).success,
  );
  assert(
    !notificationsGet.output.safeParse({
      ...item,
      ...common,
      occurred_at: "yesterday",
    }).success,
  );
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

Deno.test("platform/notifications#R13, R14 [agent-I18b]: get·list 출력의 ask는 선택이고 role·agent 이름·앱 자리·대상 참조 모양이다", () => {
  const item = { notification, source_event: "ProblemOpened" };
  const common = { as_of_seq: "42", next_cursor: null };
  const app = "app_01arz3ndektsv4rrffq69g5fav";
  const ask = {
    role: "app_engineer",
    agent_name: "App Engineer",
    first_context: {
      work_place: { kind: "app", id: app },
      target: { kind: "problem", id: "prb_01arz3ndektsv4rrffq69g5fav" },
    },
  };
  const release = {
    ...ask,
    first_context: {
      ...ask.first_context,
      target: { kind: "release", id: "rel_01arz3ndektsv4rrffq69g5fav" },
    },
  };
  // 없어도(다른 actor), null이어도(agent 없는 계기) 통과한다.
  assert(notificationsGet.output.safeParse({ ...item, ...common }).success);
  assert(
    notificationsGet.output.safeParse({ ...item, ...common, ask }).success,
  );
  assert(
    notificationsGet.output.safeParse({ ...item, ...common, ask: null })
      .success,
  );
  assert(
    notificationsList.output.safeParse({
      notifications: [{ ...item, ask }, { ...item, ask: release }, {
        ...item,
        ask: null,
      }, item],
      ...common,
    }).success,
  );
  const bad = (value: unknown) =>
    !notificationsGet.output.safeParse({ ...item, ...common, ask: value })
      .success;
  // 모르는 role, 앱이 아닌 자리, 대상 종류와 맞지 않는 id, 모르는 field, 빈 이름은 거절한다.
  assert(bad({ ...ask, role: "operator" }));
  assert(bad({ ...ask, agent_name: "" }));
  assert(bad({ ...ask, extra: 1 }));
  assert(bad({
    ...ask,
    first_context: {
      ...ask.first_context,
      work_place: { kind: "project", id: app },
    },
  }));
  assert(bad({
    ...ask,
    first_context: {
      ...ask.first_context,
      work_place: { kind: "app", id: "prj_01arz3ndektsv4rrffq69g5fav" },
    },
  }));
  assert(bad({
    ...ask,
    first_context: {
      ...ask.first_context,
      target: { kind: "problem", id: "rel_01arz3ndektsv4rrffq69g5fav" },
    },
  }));
  assert(bad({
    ...ask,
    first_context: {
      ...ask.first_context,
      target: { kind: "ticket", id: "tkt_01arz3ndektsv4rrffq69g5fav" },
    },
  }));
  // 본문 복사본이나 run·message 같은 것은 실을 자리가 없다.
  assert(bad({ ...ask, first_context: { ...ask.first_context, body: "x" } }));
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

Deno.test("platform/notifications#R13, R14: 계약 위반 행의 ask는 project 자리와 context 대상이고 앱 자리와 섞이지 않는다", () => {
  const item = { notification, source_event: "ContextViolationsRecorded" };
  const common = { as_of_seq: "42", next_cursor: null };
  const ask = {
    role: "context_engineer",
    agent_name: "Context Engineer",
    first_context: {
      work_place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      target: { kind: "context", id: "ctx_01arz3ndektsv4rrffq69g5fav" },
    },
  };
  const parses = (value: unknown) =>
    notificationsGet.output.safeParse({ ...item, ...common, ask: value })
      .success;
  assert(parses(ask));
  // 앱 자리에 context 대상, project 자리에 문제 대상, 모르는 field는 거절한다.
  assert(
    !parses({
      ...ask,
      first_context: {
        ...ask.first_context,
        work_place: { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fav" },
      },
    }),
  );
  assert(
    !parses({
      ...ask,
      first_context: {
        ...ask.first_context,
        target: { kind: "problem", id: "prb_01arz3ndektsv4rrffq69g5fav" },
      },
    }),
  );
  assert(
    !parses({
      ...ask,
      first_context: { ...ask.first_context, body: "x" },
    }),
  );
});

Deno.test("[ctx-I35] platform/notifications#R1 platform/notifications#R13: context 위반 수 계기는 documents/contexts 소유이고 늘었을 때만 조건이며 Context Engineer를 project 자리에서 부른다", () => {
  const trigger = NOTIFICATION_TRIGGERS.find((item) =>
    item.event === "ContextViolationsRecorded"
  );
  assertEquals(trigger, {
    event: "ContextViolationsRecorded",
    owner: "documents/contexts",
    condition: "count_rose",
    ask_agent: "context_engineer",
    first_context: { work_place: "project", target: "context" },
  });
});
