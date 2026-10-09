// platform/notifications#R1, R2, R3: 계기 표의 모든 소유 concern 정책이 notifications 구독자를
// 열어 실제 core에서 notification이 listable하게 된다. 사람 데이터 root는 열지 않고 임시
// LOPHN_HOME의 실제 core를 HTTP route로만 본다. 소유 concern이 아직 발생 command를 내지 않는
// 계기는 시험용 등록(testing/notification-sources.ts)이 실제 writer 경로로 contract event를 낸다.
import { assert, assertEquals } from "@std/assert";
import { NOTIFICATION_TRIGGERS } from "../../packages/contracts/platform/mod.ts";
import { createCoreRegistration } from "./testing/notification-sources.ts";
import type { TeamModule } from "./registration.ts";
import { NOTIFICATIONS_PRINCIPAL } from "./platform.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

type Reply = { status: number; body: Record<string, unknown> };

async function call(
  harness: CoreHarness,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function id(prefix: string, n: number): string {
  return `${prefix}_${"0".repeat(25)}${n}`;
}

const HASH = "ab".repeat(32);
const CLOSURE = {
  reason: "verified",
  basis_seq: "1",
  release: id("rel", 1),
  verification: id("vrf", 1),
  confirmation: null,
  last_report: null,
  note: null,
};
const PAUSED_BY_FAILURES = {
  kind: "consecutive_failures",
  detail: "연속 세 번 실패했다",
  runs: [id("run", 1), id("run", 2), id("run", 3)],
  target: null,
};
const TICKET_BASE = {
  app: id("app", 1),
  problems: [],
  completion_seq: "1",
  release: id("rel", 1),
  fix_records: [],
};

// 계기 표 한 줄마다 조건을 채우는 source event 하나. owner 정책이 이 event를 notifications
// 구독자에게 열어야 core에서 notification이 된다.
const SOURCES: Record<string, { subject: string; payload: unknown }> = {
  ProblemOpened: {
    subject: id("prb", 1),
    payload: {
      app: id("app", 1),
      group_key: {
        kind: "invalid_report",
        code: "_invalid_report",
        discriminator: "x",
      },
      report: id("rpt", 1),
    },
  },
  ProblemReopened: {
    subject: id("prb", 2),
    payload: { previous: CLOSURE, report: id("rpt", 2), decision: null },
  },
  ProblemClosed: {
    subject: id("prb", 3),
    payload: { previous_status: "open", closure: CLOSURE },
  },
  QuestionCreated: {
    subject: id("qst", 1),
    payload: { run: id("run", 1), session: null, options: [] },
  },
  AssignmentPaused: {
    subject: id("asg", 1),
    payload: {
      before: 1,
      after: 2,
      reason: PAUSED_BY_FAILURES,
      definition_hash: HASH,
    },
  },
  TicketConfirmed: { subject: id("tkt", 1), payload: TICKET_BASE },
  TicketCheckFailed: {
    subject: id("tkt", 2),
    payload: { ...TICKET_BASE, failed_conditions: [0] },
  },
  ContextWatchedItemChanged: {
    subject: id("ctx", 1),
    payload: {
      target: { kind: "document", document: id("doc", 1), section: null },
      before_version: null,
      after_version: id("ver", 1),
      source_seq: "1",
      change_kind: "content_changed",
    },
  },
  ReleaseActivationFailed: {
    subject: id("rel", 1),
    payload: { started_seq: "1", failure: { code: "x", summary: "y" } },
  },
};

// 정책을 낸 팀 module을 reader에 건넨다(events/list registry는 이 module들에서 모인다).
// 계기를 내는 시험용 등록은 writer가 다시 import한다.
const MODULES = [
  "./testing/notification-sources.ts",
  "./problems.ts",
  "./lophn-agent.ts",
  "./tickets.ts",
  "./apps.ts",
  "./documents.ts",
].map((path) => new URL(path, import.meta.url).href);

async function withCore(
  run: (harness: CoreHarness) => Promise<void>,
): Promise<void> {
  const opened = await createCoreHarness({
    teams: [{ createCoreRegistration } as TeamModule],
    teamModules: MODULES,
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  try {
    await run(opened.value);
  } finally {
    await opened.value.close();
  }
}

async function login(
  harness: CoreHarness,
  actor: "user" | "machine" | "agent" | "app" | "coding_agent",
  principal: string,
  operations: string[],
): Promise<string> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value.token;
}

async function emit(
  harness: CoreHarness,
  token: string,
  event: string,
  source: { subject: string; payload: unknown },
): Promise<void> {
  const emitted = await call(harness, "notification_sources/emit", token, {
    input: { event, subject: source.subject, payload: source.payload },
    idempotency_key: `emit-${event}-${crypto.randomUUID()}`,
    compare: {},
    prepared: [],
  });
  assertEquals(emitted.status, 200, JSON.stringify(emitted.body));
}

type Listed = {
  notification: { id: string; source_seq: string };
  source_event: string;
};

async function listedEvents(
  harness: CoreHarness,
  token: string,
  expected: number,
): Promise<Listed[]> {
  let items: Listed[] = [];
  for (let attempt = 0; attempt < 150; attempt++) {
    const listed = await call(harness, "notifications/list", token, {});
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    items = listed.body["notifications"] as Listed[];
    if (items.length >= expected) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return items;
}

const EVENT_TYPES = NOTIFICATION_TRIGGERS.map((trigger) => trigger.event)
  // ApprovalRequestCreated는 platform 소유이고 platform_test.ts가 실제 생성 command로 본다.
  .filter((event) => event !== "ApprovalRequestCreated");

Deno.test("platform/notifications#R1: 소유 concern 계기 event 아홉 중 platform 밖 여덟이 core에서 listable notification이 된다", async () => {
  assertEquals(Object.keys(SOURCES).sort(), [...EVENT_TYPES].sort());
  await withCore(async (harness) => {
    const user = await login(harness, "user", "user-1", [
      "notification_source.emit",
      "ListNotifications",
      "GetNotification",
    ]);
    for (const event of EVENT_TYPES) {
      await emit(harness, user, event, SOURCES[event]);
    }
    const items = await listedEvents(harness, user, EVENT_TYPES.length);
    assertEquals(
      items.map((item) => item.source_event),
      EVENT_TYPES,
    );
    // 소식 하나마다 notification 하나이고 source_seq로 같은 사실을 가리킨다(R4).
    assertEquals(
      new Set(items.map((item) => item.notification.source_seq)).size,
      EVENT_TYPES.length,
    );
    const got = await call(harness, "notifications/get", user, {
      notification: items[0].notification.id,
    });
    assertEquals(got.status, 200, JSON.stringify(got.body));
  });
});

Deno.test("platform/notifications#R2: 사람이 직접 멈춘 assignment는 같은 정책을 지나도 notification이 되지 않는다", async () => {
  await withCore(async (harness) => {
    const user = await login(harness, "user", "user-1", [
      "notification_source.emit",
      "ListNotifications",
    ]);
    await emit(harness, user, "AssignmentPaused", {
      subject: id("asg", 2),
      payload: {
        before: 1,
        after: 2,
        reason: { kind: "user", detail: "잠시 멈춤", runs: [], target: null },
        definition_hash: HASH,
      },
    });
    // 뒤따르는 계기가 notification이 되면 앞의 비계기 event는 읽고 지나간 것이다.
    await emit(harness, user, "QuestionCreated", SOURCES.QuestionCreated);
    const items = await listedEvents(harness, user, 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const again = await listedEvents(harness, user, 1);
    assertEquals(items.map((item) => item.source_event), ["QuestionCreated"]);
    assertEquals(again.map((item) => item.source_event), ["QuestionCreated"]);
  });
});

Deno.test("platform/notifications#R1 platform/identity#R8: agent·app·coding agent·다른 machine은 계기 event를 일어난 적 없는 event와 같은 답으로 받는다", async () => {
  await withCore(async (harness) => {
    const user = await login(harness, "user", "user-1", [
      "notification_source.emit",
      "ListNotifications",
      "ListEvents",
      ...EVENT_TYPES,
    ]);
    for (const event of EVENT_TYPES) {
      await emit(harness, user, event, SOURCES[event]);
    }
    // notifications 구독자가 모두 읽고 지나갔다: 실제 core에서 정책이 열렸다는 증거다.
    await listedEvents(harness, user, EVENT_TYPES.length);

    const operations = ["ListEvents", ...EVENT_TYPES];
    const outsiders: [string, string][] = [
      ["agent", await login(harness, "agent", "agent-1", operations)],
      ["app", await login(harness, "app", "app-1", operations)],
      [
        "coding_agent",
        await login(harness, "coding_agent", "cac-1", operations),
      ],
      [
        "other-machine",
        await login(harness, "machine", "machine:other", operations),
      ],
      // 이름만 같은 machine. 현재 credential 기록(credential_ref)이 달라 notifications가 아니다.
      [
        "name-only",
        await login(harness, "machine", NOTIFICATIONS_PRINCIPAL, operations),
      ],
    ];
    for (const [who, token] of outsiders) {
      // 일어난 적 없는 등록 event. 계기 event와 같은 모양이어야 존재가 새지 않는다.
      const absent = await call(harness, "events/list", token, {
        after_seq: "0",
        types: ["VerificationRecorded"],
      });
      assertEquals(absent.status, 200, who);
      for (const event of EVENT_TYPES) {
        const present = await call(harness, "events/list", token, {
          after_seq: "0",
          types: [event],
        });
        assertEquals(present.status, 200, `${who} ${event}`);
        assertEquals(present.body, absent.body, `${who} ${event}`);
      }
      const everything = await call(harness, "events/list", token, {
        after_seq: "0",
      });
      assertEquals(everything.status, 200, who);
      assertEquals(everything.body["events"], [], who);
    }

    // 사람 token은 계기 event 자체는 못 보고, shell 구독이 쓰는 notification event만 본다.
    const absentUser = await call(harness, "events/list", user, {
      after_seq: "0",
      types: ["VerificationRecorded"],
    });
    assertEquals(absentUser.status, 200, "user");
    for (const event of EVENT_TYPES) {
      const present = await call(harness, "events/list", user, {
        after_seq: "0",
        types: [event],
      });
      assertEquals(present.status, 200, `user ${event}`);
      assertEquals(present.body, absentUser.body, `user ${event}`);
    }
    const userEvents = await call(harness, "events/list", user, {
      after_seq: "0",
    });
    assertEquals(userEvents.status, 200, "user");
    const visible = userEvents.body["events"] as { type: string }[];
    assert(visible.length > 0, "user");
    assert(
      visible.every((event) =>
        event.type === "NotificationCreated" ||
        event.type === "NotificationRead"
      ),
      JSON.stringify(visible.map((event) => event.type)),
    );
  });
});
