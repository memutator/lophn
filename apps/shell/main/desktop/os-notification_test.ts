import assert from "node:assert/strict";
import { test } from "node:test";

import { en } from "../../../../packages/design/wording/en.ts";
import {
  type ArrivedEvent,
  createOsNotifications,
  NOTIFICATION_CREATED,
  optInFromSettings,
  OS_NOTIFICATIONS_KEY,
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

function setup(
  { optedIn = true, notifier = fakeNotifier() }: {
    optedIn?: boolean | (() => Promise<boolean>);
    notifier?: ReturnType<typeof fakeNotifier>;
  } = {},
) {
  const opened: string[] = [];
  const failures: OsNotificationFailure[] = [];
  const logs: string[] = [];
  let reads = 0;
  const notifications = createOsNotifications({
    notifier: notifier.notifier,
    optedIn: typeof optedIn === "function" ? optedIn : () => {
      reads += 1;
      return Promise.resolve(optedIn);
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
  const run = setup();
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
  // 읽음·결정은 open의 몫이 아니다. 이 모듈은 core에 쓰지 않는다(optedIn read만 한다).
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
  // 원문 오류는 안내·log에 넘기지 않는다.
  assert.equal(run.logs.join("\n").includes("dbus"), false);
});

test("shell/desktop#R10: OS가 notification을 지원하지 않으면 unsupported로 한 번 안내한다", async () => {
  const notifier = fakeNotifier({ supported: false });
  const run = setup({ notifier });
  await run.notifications.arrived([created("ntf_a"), created("ntf_b")]);
  assert.equal(notifier.attempts(), 0);
  assert.deepEqual(run.failures, ["unsupported"]);
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
