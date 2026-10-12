import assert from "node:assert/strict";
import { test } from "node:test";

import { en } from "../../../../packages/design/wording/en.ts";
import {
  type ArrivedEvent,
  createOsNotifications,
  displayFromReply,
  noteOf,
  NOTIFICATION_CREATED,
  optInFromSettings,
  OS_NOTIFICATIONS_KEY,
  type OsDeliveryReason,
  type OsDisplayRequest,
  type OsNote,
  type OsNotificationFailure,
  type OsNotifier,
} from "./os-notification.ts";

const created = (id: string): ArrivedEvent => ({
  type: NOTIFICATION_CREATED,
  subject: id,
});

// 실제 OS에 아무것도 올리지 않는 가짜. 올린 것과 클릭 handler만 기억한다.
function fakeNotifier(
  { supported = true, fails = false }: {
    supported?: boolean;
    fails?: boolean;
  } = {},
) {
  const shown: OsNote[] = [];
  const clicks: (() => void)[] = [];
  let attempts = 0;
  const notifier: OsNotifier = {
    isSupported: () => supported,
    show(note, onClick) {
      attempts += 1;
      if (fails) {
        throw new Error("dbus: org.freedesktop.Notifications at /home/me");
      }
      shown.push(note);
      clicks.push(onClick);
    },
  };
  return { notifier, shown, clicks, attempts: () => attempts };
}

// core가 주는 OS 표시 요청. kind는 계기 종류다. 켜지 않았으면 core가 null을 준다.
const requestOf = (id: string, kind = "QuestionCreated"): OsDisplayRequest => ({
  notification: id,
  title: { kind },
  open: { kind: "question", id: "qst_x" },
});

function setup(
  { optedIn = true, notifier = fakeNotifier(), kind }: {
    optedIn?: boolean | (() => Promise<boolean>);
    notifier?: ReturnType<typeof fakeNotifier>;
    kind?: string;
  } = {},
) {
  const opened: string[] = [];
  const failures: OsNotificationFailure[] = [];
  const reports: [string, OsDeliveryReason][] = [];
  const logs: string[] = [];
  let reads = 0;
  const notifications = createOsNotifications({
    notifier: notifier.notifier,
    display: async (id) => {
      reads += 1;
      const on = typeof optedIn === "function" ? await optedIn() : optedIn;
      return on ? requestOf(id, kind) : null;
    },
    report: (id, reason) => {
      reports.push([id, reason]);
      return Promise.resolve();
    },
    open: (id) => opened.push(id),
    unavailable: (reason) => failures.push(reason),
    log: (message) => logs.push(message),
  });
  return {
    notifications,
    notifier,
    opened,
    failures,
    reports,
    logs,
    reads: () => reads,
  };
}

test("shell/desktop#R10: 사람이 켜지 않으면 OS에 올리지 않는다(기본 꺼짐)", async () => {
  const off = setup({ optedIn: false });
  await off.notifications.arrived([created("ntf_a")]);
  assert.deepEqual(off.notifier.shown, []);
  assert.equal(off.reads(), 1);
  // 읽지 못하면 꺼짐으로 본다.
  const broken = setup({ optedIn: () => Promise.reject(new Error("down")) });
  await broken.notifications.arrived([created("ntf_b")]);
  assert.deepEqual(broken.notifier.shown, []);
});

test("shell/desktop#R10: 켜져 있으면 지금 도착한 NotificationCreated를 제목 lophn과 고정 본문으로만 올린다", async () => {
  // 표 밖 계기 종류는 일반 안내 문구다.
  const run = setup({ kind: "SomethingNew" });
  await run.notifications.arrived([
    { type: "QuestionCreated", subject: "qst_x" },
    { type: "NotificationRead", subject: "ntf_a" },
    created("ntf_a"),
  ]);
  assert.equal(run.notifier.shown.length, 1);
  const note = run.notifier.shown[0]!;
  assert.deepEqual(note, {
    title: "lophn",
    body: en["common.notification.body"],
  });
  assert.equal(
    en["common.notification.body"],
    "Something needs your attention.",
  );
  // 이름·내용·id·secret·원문은 OS에 넘기지 않는다. 고정 문구 두 개뿐이다.
  assert.deepEqual(Object.keys(note).sort(), ["body", "title"]);
  assert.equal(JSON.stringify(note).includes("ntf_a"), false);
});

test("platform/notifications#R9: 올리는 문구는 core가 준 계기 종류의 고정 문구이고 id·열 곳·원문은 없다", () => {
  const kinds: [string, string][] = [
    ["QuestionCreated", "A question is waiting"],
    ["ApprovalRequestCreated", "A decision is waiting"],
    ["ProblemOpened", "An issue was reported"],
    ["TicketCheckFailed", "A task's check failed"],
    ["ReleaseActivationFailed", "An app version couldn't start"],
    ["ContextViolationsRecorded", "A context has more violations"],
    ["ToString", en["common.notification.body"]],
    ["__proto__", en["common.notification.body"]],
  ];
  for (const [kind, body] of kinds) {
    const note = noteOf(requestOf("ntf_secret_id", kind));
    assert.deepEqual(note, { title: "lophn", body });
    assert.equal(JSON.stringify(note).includes("ntf_secret_id"), false);
    assert.equal(JSON.stringify(note).includes("qst_x"), false);
  }
});

test("platform/notifications#R9: display 응답은 모양이 맞을 때만 요청이 되고 켜지 않았으면 null이다", () => {
  const good = {
    display: {
      notification: "ntf_a",
      title: { kind: "QuestionCreated" },
      open: { kind: "question", id: "qst_x" },
    },
    as_of_seq: "1",
    next_cursor: null,
  };
  assert.deepEqual(displayFromReply(good), good.display);
  assert.deepEqual(
    displayFromReply({ display: { ...good.display, open: null } })?.open,
    null,
  );
  for (
    const bad of [null, {}, { display: null }, { display: {} }, {
      display: { notification: "ntf_a", title: "x", open: null },
    }]
  ) {
    assert.equal(displayFromReply(bad), null);
  }
});

test("shell/desktop#R7: 같은 notification은 한 번만 올리고 켜기 전에 도착한 것은 나중에 몰아 올리지 않는다", async () => {
  let on = false;
  const run = setup({ optedIn: () => Promise.resolve(on) });
  await run.notifications.arrived([created("ntf_early")]);
  on = true;
  await run.notifications.arrived([created("ntf_early"), created("ntf_a")]);
  await run.notifications.arrived([created("ntf_a")]);
  await Promise.all([
    run.notifications.arrived([created("ntf_b")]),
    run.notifications.arrived([created("ntf_b")]),
  ]);
  assert.equal(run.notifier.shown.length, 2);
});

test("shell/desktop#R10: 클릭은 things-to-confirm을 열 뿐이고 그 전에는 아무것도 열지 않는다", async () => {
  const run = setup();
  await run.notifications.arrived([created("ntf_a"), created("ntf_b")]);
  // 자동 표시는 창·focus를 건드리지 않는다.
  assert.deepEqual(run.opened, []);
  run.notifier.clicks[1]!();
  assert.deepEqual(run.opened, ["ntf_b"]);
  // 읽음·결정은 open의 몫이 아니다. 이 모듈은 core에 display를 읽을 뿐 읽음·결정을 쓰지 않는다.
  assert.equal(run.reads(), 2);
});

test("shell/desktop#R10: OS 표시가 실패하면 그 기능만 한 번 안내하고 다시 시도하지 않는다", async () => {
  const notifier = fakeNotifier({ fails: true });
  const run = setup({ notifier });
  await run.notifications.arrived([created("ntf_a")]);
  await run.notifications.arrived([created("ntf_a"), created("ntf_b")]);
  assert.equal(notifier.attempts(), 1);
  assert.deepEqual(run.failures, ["show-failed"]);
  assert.equal(run.notifications.state, "unavailable");
  // 올리지 못한 notification은 고정 이유 하나로 core에 알린다. 원문 오류는 가지 않는다.
  assert.deepEqual(run.reports, [
    ["ntf_a", "show_failed"],
    ["ntf_b", "show_failed"],
  ]);
  // 원문 오류는 안내·log에 넘기지 않는다.
  assert.equal(run.logs.join("\n").includes("dbus"), false);
});

test("shell/desktop#R10: OS가 notification을 지원하지 않으면 unsupported로 한 번 안내한다", async () => {
  const notifier = fakeNotifier({ supported: false });
  const run = setup({ notifier });
  await run.notifications.arrived([created("ntf_a"), created("ntf_b")]);
  assert.equal(notifier.attempts(), 0);
  assert.deepEqual(run.failures, ["unsupported"]);
  assert.deepEqual(run.reports, [
    ["ntf_a", "unsupported"],
    ["ntf_b", "unsupported"],
  ]);
});

test("shell/desktop#R10: opt-in은 settings.get 응답의 shell.os_notifications가 true일 때만이다", () => {
  assert.equal(OS_NOTIFICATIONS_KEY, "shell.os_notifications");
  const reply = (value: unknown) => ({
    settings: [{ key: OS_NOTIFICATIONS_KEY, value }],
    revision: 1,
  });
  assert.equal(optInFromSettings(reply(true)), true);
  assert.equal(optInFromSettings(reply(false)), false);
  assert.equal(optInFromSettings(reply("true")), false);
  assert.equal(optInFromSettings({ settings: [], revision: 1 }), false);
  assert.equal(optInFromSettings(null), false);
});

test("platform/notifications#R10: 켜지 않았으면 올리지도 알리지도 않고, 알리기가 실패해도 다시 시도하지 않는다", async () => {
  const off = setup({
    optedIn: false,
    notifier: fakeNotifier({ fails: true }),
  });
  await off.notifications.arrived([created("ntf_a")]);
  assert.deepEqual(off.reports, []);
  assert.equal(off.notifications.state, "ready");

  const notifier = fakeNotifier({ fails: true });
  let reportCalls = 0;
  const logs: string[] = [];
  const notifications = createOsNotifications({
    notifier: notifier.notifier,
    display: (id) => Promise.resolve(requestOf(id)),
    report: () => {
      reportCalls += 1;
      return Promise.reject(new Error("core down at /home/me"));
    },
    open: () => {},
    log: (message) => logs.push(message),
  });
  await notifications.arrived([created("ntf_a")]);
  assert.equal(reportCalls, 1);
  assert.equal(notifier.attempts(), 1);
  assert.equal(logs.join("\n").includes("/home/me"), false);
});

test("platform/notifications#R12: 표시와 실패 보고는 창을 열거나 focus를 바꾸지 않는다", async () => {
  const notifier = fakeNotifier({ fails: true });
  const run = setup({ notifier });
  await run.notifications.arrived([created("ntf_a")]);
  assert.deepEqual(run.opened, []);
  const ok = setup();
  await ok.notifications.arrived([created("ntf_b")]);
  assert.deepEqual(ok.opened, []);
});
