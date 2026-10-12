// platform/notifications#R9, R10, R12: 실제 core(임시 LOPHN_HOME)에서 OS 표시 요청과 전달 실패가
// 조회에 보이는 길을 HTTP route로 본다. 사람 데이터 root와 실제 OS 표시는 열지 않는다. 표시 실패
// 보고는 shell main 대신 시험이 route를 직접 부른다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { type Core, startCore } from "../main/daemon/core.ts";
import { createCoreRegistration } from "../testing/notification-sources.ts";
import type { TeamModule } from "../main/daemon/registration.ts";

type Reply = { status: number; body: Record<string, unknown> };

const QUESTION = "qgr_01arz3ndektsv4rrffq69g5fav";
const MODULES = ["./testing/notification-sources.ts", "./lophn-agent.ts"].map(
  (path) => new URL(path, import.meta.url).href,
);
const USER_OPERATIONS = [
  "notification_source.emit",
  "ListNotifications",
  "GetNotification",
  "notification.os_display",
  "notification.os_delivery_failed",
  "SettingsDefinitions",
  "GetSettings",
  "ApplySettings",
  "ListEvents",
];

async function post(
  core: Core,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function start(home: string, seed: number): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration } as TeamModule],
    teamModules: MODULES,
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(seed),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  return started.value;
}

let logins = 0;
async function login(
  core: Core,
  actor: string,
  operations: string[],
): Promise<string> {
  logins += 1;
  const token = `T${logins}`.padEnd(43, "x");
  const context: AuthenticatedContext = {
    principal: `p-${logins}`,
    actor,
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: `cred-${core.epoch}-${logins}`,
  } as AuthenticatedContext;
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, token);
  assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  return token;
}

async function withHome(
  run: (home: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-ntf-delivery-" });
  try {
    await run(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

type Listed = {
  notification: { id: string };
  source_event: string;
  delivery?: { state: string; reason?: string; observed_at?: string };
};

async function waitForNotification(
  core: Core,
  token: string,
): Promise<Listed> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const listed = await post(core, "notifications/list", token, {});
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const items = listed.body["notifications"] as Listed[];
    if (items.length > 0) return items[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("notification이 만들어지지 않았다");
}

async function emitQuestion(core: Core, token: string): Promise<Listed> {
  const emitted = await post(core, "notification_sources/emit", token, {
    input: {
      event: "QuestionCreated",
      subject: QUESTION,
      payload: {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
        questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
      },
    },
    idempotency_key: "emit-question",
    compare: {},
    prepared: [],
  });
  assertEquals(emitted.status, 200, JSON.stringify(emitted.body));
  return await waitForNotification(core, token);
}

async function setOsNotifications(
  core: Core,
  token: string,
  value: boolean,
  revision: number,
): Promise<void> {
  const definitions = await post(core, "settings/definitions", token, {});
  const defaultsRevision = (definitions.body as { defaults_revision: string })
    .defaults_revision;
  const applied = await post(core, "settings/apply", token, {
    input: {
      changes: [{
        layer: "common",
        key: "shell.os_notifications",
        action: "set",
        value,
      }],
    },
    idempotency_key: `os-notifications-${revision}`,
    compare: { revision, defaults_revision: defaultsRevision },
    prepared: [],
  });
  assertEquals(applied.status, 200, JSON.stringify(applied.body));
}

async function deliveryOf(
  core: Core,
  token: string,
  id: string,
): Promise<unknown> {
  const got = await post(core, "notifications/get", token, {
    notification: id,
  });
  assertEquals(got.status, 200, JSON.stringify(got.body));
  const listed = await post(core, "notifications/list", token, {});
  const fromList = (listed.body["notifications"] as Listed[]).find((item) =>
    item.notification.id === id
  );
  // get과 list는 같은 전달 상태를 준다.
  assertEquals(fromList?.delivery, got.body["delivery"]);
  return got.body["delivery"];
}

Deno.test("platform/notifications#R9, R10: 사람이 켜지 않았으면 전달은 not_requested이고 OS 표시 요청이 비어 있다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 1);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      assertEquals(await deliveryOf(core, user, item.notification.id), {
        state: "not_requested",
      });
      const display = await post(core, "notifications/display", user, {
        notification: item.notification.id,
      });
      assertEquals(display.status, 200, JSON.stringify(display.body));
      assertEquals(display.body["display"], null);
    } finally {
      await core.shutdown();
    }
  });
});

Deno.test("platform/notifications#R9, R10: 켠 뒤 보고가 없으면 unconfirmed이고 OS 표시 요청은 최소 제목과 열 곳뿐이다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 2);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      await setOsNotifications(core, user, true, 0);
      assertEquals(await deliveryOf(core, user, item.notification.id), {
        state: "unconfirmed",
      });
      const display = await post(core, "notifications/display", user, {
        notification: item.notification.id,
      });
      assertEquals(display.status, 200, JSON.stringify(display.body));
      assertEquals(display.body["display"], {
        notification: item.notification.id,
        title: { kind: "QuestionCreated" },
        open: { kind: "question", id: QUESTION },
      });
    } finally {
      await core.shutdown();
    }
  });
});

Deno.test("platform/notifications#R10: 표시 실패 보고 뒤 다음 조회가 고정 이유와 관측 시각으로 failed를 보이고 ledger는 그대로다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 3);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      await setOsNotifications(core, user, true, 0);
      const before = await post(core, "events/list", user, { after_seq: "0" });
      const reported = await post(core, "notifications/delivery", user, {
        notification: item.notification.id,
        reason: "show_failed",
      });
      assertEquals(reported.status, 200, JSON.stringify(reported.body));
      const delivery = await deliveryOf(core, user, item.notification.id);
      assertEquals(delivery, {
        state: "failed",
        reason: "show_failed",
        observed_at: "2024-01-01T00:00:00.000Z",
      });
      // 같은 notification이 근거와 함께 그대로 있고 새 event·상태가 생기지 않는다.
      const after = await post(core, "events/list", user, { after_seq: "0" });
      assertEquals(after.body, before.body);
      const again = await post(core, "notifications/list", user, {});
      assertEquals(
        (again.body["notifications"] as Listed[]).map((entry) =>
          entry.notification.id
        ),
        [item.notification.id],
      );
    } finally {
      await core.shutdown();
    }
  });
});

Deno.test("platform/notifications#R10: 재시작하면 이전 실패 관측을 확인할 수 없어 unconfirmed이다(성공으로 채우지 않는다)", async () => {
  await withHome(async (home) => {
    let id = "";
    const first = await start(home, 4);
    try {
      const user = await login(first, "user", USER_OPERATIONS);
      const item = await emitQuestion(first, user);
      id = item.notification.id;
      await setOsNotifications(first, user, true, 0);
      const reported = await post(first, "notifications/delivery", user, {
        notification: id,
        reason: "unsupported",
      });
      assertEquals(reported.status, 200, JSON.stringify(reported.body));
      assertEquals(
        (await deliveryOf(first, user, id) as { state: string }).state,
        "failed",
      );
    } finally {
      await first.shutdown();
    }
    const second = await start(home, 5);
    try {
      const user = await login(second, "user", USER_OPERATIONS);
      assertEquals(await deliveryOf(second, user, id), {
        state: "unconfirmed",
      });
    } finally {
      await second.shutdown();
    }
  });
});

Deno.test("platform/notifications#R10: 원문 오류나 모르는 이유는 invalid_input이고 기억하지 않는다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 6);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      await setOsNotifications(core, user, true, 0);
      for (
        const reason of [
          "Error: dbus org.freedesktop.Notifications at /home/me",
          "",
        ]
      ) {
        const rejected = await post(core, "notifications/delivery", user, {
          notification: item.notification.id,
          reason,
        });
        assertEquals(rejected.status, 400, JSON.stringify(rejected.body));
        assertEquals(
          (rejected.body as { error?: { code?: string } }).error?.code,
          "invalid_input",
        );
      }
      assertEquals(await deliveryOf(core, user, item.notification.id), {
        state: "unconfirmed",
      });
    } finally {
      await core.shutdown();
    }
  });
});

Deno.test("platform/notifications#R10: shell(user)가 아닌 actor는 표시 실패를 보고할 수 없다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 7);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      await setOsNotifications(core, user, true, 0);
      const outsiders = [
        await login(core, "agent:asg_01arz3ndektsv4rrffq69g5fav", [
          "GetNotification",
        ]),
        await login(core, "app:app_01arz3ndektsv4rrffq69g5fav", [
          "GetNotification",
        ]),
        await login(core, "machine", ["GetNotification"]),
      ];
      for (const token of outsiders) {
        const refused = await post(core, "notifications/delivery", token, {
          notification: item.notification.id,
          reason: "show_failed",
        });
        assertEquals(refused.status, 403, JSON.stringify(refused.body));
        const display = await post(core, "notifications/display", token, {
          notification: item.notification.id,
        });
        assertEquals(display.status, 403, JSON.stringify(display.body));
      }
      assertEquals(await deliveryOf(core, user, item.notification.id), {
        state: "unconfirmed",
      });
    } finally {
      await core.shutdown();
    }
  });
});

Deno.test("platform/notifications#R10: 없는 notification과 볼 수 없는 호출자는 같은 not_found로 답한다", async () => {
  await withHome(async (home) => {
    const core = await start(home, 8);
    try {
      const user = await login(core, "user", USER_OPERATIONS);
      const item = await emitQuestion(core, user);
      // GetNotification 자격이 없는 사람 credential.
      const narrow = await login(core, "user", ["ListNotifications"]);
      const body = (id: string) => ({
        notification: id,
        reason: "show_failed",
      });
      const missing = await post(
        core,
        "notifications/delivery",
        user,
        body("ntf_01arz3ndektsv4rrffq69g5fax"),
      );
      const outOfScope = await post(
        core,
        "notifications/delivery",
        narrow,
        body(item.notification.id),
      );
      assertEquals(missing.status, 404, JSON.stringify(missing.body));
      assertEquals(outOfScope.status, missing.status);
      assertEquals(outOfScope.body, missing.body);
      // 범위 밖 호출은 관측을 남기지 않는다.
      await setOsNotifications(core, user, true, 0);
      assertEquals(await deliveryOf(core, user, item.notification.id), {
        state: "unconfirmed",
      });
    } finally {
      await core.shutdown();
    }
  });
});
