import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok, type Result } from "../../../base/mod.ts";
import {
  NOTICE_EPHEMERAL_PER_APP_MAX,
  NOTICE_PERSISTENT_PER_APP_MAX,
  noticePost,
} from "../../../protocol/apps/notice.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { clearAppNotices, createNoticeCommands } from "./commands.ts";
import {
  noticeSchemaSteps,
  noticeUnifiedSchemaSteps,
  productVersionSchemaSteps,
} from "./schema.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

const ctxOf = (actor: string): RequestContext => ({
  principal: actor,
  actor,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...appsSchemaSteps,
    ...noticeSchemaSteps,
    ...noticeUnifiedSchemaSteps,
    ...productVersionSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  for (const [id, slug] of [
    [APP, "usage"],
    [OTHER, "other"],
  ]) {
    db.prepare(
      `insert into apps (id, slug, name, description, run_enabled, revision, status)
       values (?, ?, ?, 'tracks usage', 1, '1', 'active')`,
    ).run(id, slug, slug);
  }
  const pushed: { type: string; payload: { id: string } }[] = [];
  let at = 0;
  let ids = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    now: () => new Date(Date.UTC(2026, 10, 5) + ++at * 1000).toISOString(),
    newId: (prefix: string) => `${prefix}_${String(++ids).padStart(26, "0")}`,
    port: (key: unknown) =>
      key === afterCommit
        ? {
            push: (_topic: string, data: (typeof pushed)[number]) =>
              pushed.push(data),
          }
        : undefined,
  } as unknown as Tx;
  const commands = createNoticeCommands();
  const run = <T>(handle: unknown, actor: string, input: unknown): Result<T> =>
    (handle as (...a: unknown[]) => Result<T>)(tx, ctxOf(actor), input);
  return {
    db,
    tx,
    pushed,
    post: (
      input: { title: string; key?: string; persistent?: boolean },
      app = APP,
    ) => run<{ id: string }>(commands.post.handle, `app:${app}`, input),
    observe: (version: string, fresh: boolean) => {
      const done = run<{ changed: boolean; from: string | null }>(
        commands.observeVersion.handle,
        "machine",
        { version, fresh },
      );
      return done.ok
        ? ok({ changed: done.value.changed, from: done.value.from })
        : done;
    },
    observeSdks: (
      version: string,
      fresh: boolean,
      sdks: Record<string, string>,
    ) => {
      const done = run<{ changed: boolean; sdks_changed: boolean }>(
        commands.observeVersion.handle,
        "machine",
        { version, fresh, sdks },
      );
      return done.ok
        ? done.value.sdks_changed
        : (() => {
            throw new Error(done.error.message);
          })();
    },
    record: (actor: string, input: unknown) =>
      run<{ id: string }>(commands.record.handle, actor, input),
    dismiss: (actor: string, id: string) =>
      run<{ id: string }>(commands.dismiss.handle, actor, { id }),
    markRead: (actor: string, ids: string[]) =>
      run<{ marked: number }>(commands.markRead.handle, actor, { ids }),
    count: (where = "1 = 1") =>
      Number(
        db.prepare(`select count(*) as n from notices where ${where}`).get()?.[
          "n"
        ],
      ),
  };
}

// 경계: 앱은 자기 앱의 app 줄만 쓴다. program 줄(machine)과 다른 앱의 줄, 지우기·읽음은 앱이 못 한다.
test("an app cannot write program rows or rows of another app", () => {
  const s = setup();
  // 입력에 출처·앱·종류를 실을 길이 없다.
  for (const extra of [
    { source: "program" },
    { app: OTHER },
    { kind: "release_failed" },
    { action: { kind: "open_home_skill", skill: "x", args: "" } },
  ]) {
    assert.ok(!noticePost.input.safeParse({ title: "t", ...extra }).success);
  }
  assert.deepStrictEqual(noticePost.actors, ["app"]);

  const mine = s.post({ title: "mine" });
  assert.ok(mine.ok);
  const row = s.db.prepare("select source, app, kind from notices").get();
  assert.deepStrictEqual({ ...row }, { source: "app", app: APP, kind: "app" });

  const program = {
    kind: "release_activated",
    params: { release: "2" },
    app: OTHER,
  };
  assert.deepStrictEqual(s.record(`app:${APP}`, program).ok, false);
  assert.deepStrictEqual(s.record("user", program).ok, false);
  assert.deepStrictEqual(s.dismiss(`app:${APP}`, mine.value.id).ok, false);
  assert.deepStrictEqual(s.markRead(`app:${APP}`, [mine.value.id]).ok, false);
  assert.deepStrictEqual(s.count(), 1);

  // 다른 앱 이름으로 쓴 줄도 자기 앱 줄이다: 앱은 credential이 고정한다.
  const other = s.post({ title: "other" }, OTHER);
  assert.ok(other.ok);
  assert.deepStrictEqual(s.count(`app = '${OTHER}'`), 1);
  // machine만 program 줄을 쓴다. 글은 template이 만든다.
  const recorded = s.record("machine", program);
  assert.ok(recorded.ok);
  const made = s.db
    .prepare("select source, persistent, title from notices where id = ?")
    .get(recorded.value.id);
  assert.deepStrictEqual(
    { ...made },
    {
      source: "program",
      persistent: 1,
      title: "Release 2 is live",
    },
  );
});

// 데이터 보호: 영구 줄은 지워도 읽음만 되고 남는다. 휘발 줄만 사라진다. program 줄은 DB 수준에서도 못 지운다.
test("dismissing a persistent notice keeps the row and program rows cannot be deleted", () => {
  const s = setup();
  const kept = s.post({ title: "report sent", persistent: true });
  const gone = s.post({ title: "limit low" });
  assert.ok(kept.ok && gone.ok);
  const program = s.record("machine", {
    kind: "release_failed",
    params: { release: "3", reason: "start_failed" },
    app: APP,
  });
  assert.ok(program.ok);

  assert.ok(s.dismiss("user", kept.value.id).ok);
  assert.ok(s.dismiss("user", gone.value.id).ok);
  assert.ok(s.dismiss("user", program.value.id).ok);
  assert.deepStrictEqual(s.count(`id = '${gone.value.id}'`), 0);
  assert.deepStrictEqual(s.count("persistent = 1 and read_at is not null"), 2);

  assert.throws(() =>
    s.db.exec("delete from notices where source = 'program'"),
  );
  // 앱을 보관해도 영구 줄은 남는다.
  s.post({ title: "later", persistent: true });
  s.post({ title: "ephemeral" });
  clearAppNotices(s.tx, APP);
  assert.deepStrictEqual(s.count("source = 'app' and persistent = 0"), 0);
  assert.deepStrictEqual(s.count("source = 'app' and persistent = 1"), 2);
});

// 앱의 영구 줄은 최근 200개, 휘발 줄은 50개다. program 줄은 상한이 없고 지워지지 않는다. 같은 key는 줄을 대신한다.
test("retention keeps the newest 200 persistent and 50 ephemeral rows per app and never drops program rows", () => {
  const s = setup();
  const first = s.post({ title: "limit 20", key: "limit" });
  const second = s.post({ title: "limit 10", key: "limit" });
  assert.ok(first.ok && second.ok);
  assert.deepStrictEqual(second.value.id, first.value.id);
  assert.deepStrictEqual(s.count(), 1);

  for (let n = 0; n < 3; n++) {
    assert.ok(
      s.record("machine", {
        kind: "release_activated",
        params: { release: String(n) },
        app: APP,
      }).ok,
    );
  }
  s.pushed.length = 0;
  for (let n = 0; n < NOTICE_PERSISTENT_PER_APP_MAX + 5; n++) {
    assert.ok(s.post({ title: `record ${n}`, persistent: true }).ok);
  }
  for (let n = 0; n < NOTICE_EPHEMERAL_PER_APP_MAX + 5; n++) {
    assert.ok(s.post({ title: `event ${n}` }).ok);
  }
  assert.deepStrictEqual(
    s.count(`source = 'app' and app = '${APP}' and persistent = 1`),
    NOTICE_PERSISTENT_PER_APP_MAX,
  );
  assert.deepStrictEqual(
    s.count(`source = 'app' and app = '${APP}' and persistent = 0`),
    NOTICE_EPHEMERAL_PER_APP_MAX,
  );
  assert.deepStrictEqual(s.count("source = 'program'"), 3);
  // 가장 오래된 것이 빠진다.
  assert.deepStrictEqual(s.count("title = 'record 4'"), 0);
  assert.deepStrictEqual(s.count("title = 'record 5'"), 1);
  assert.deepStrictEqual(
    s.pushed.filter((event) => event.type === "NoticeClosed").length,
    // 영구 다섯, 휘발 여섯(key 줄과 처음 다섯).
    11,
  );
});

// 옮기기: 옛 app_notices 줄이 앱이 쓴 휘발·안 읽은 줄로 그대로 옮겨지고 옛 표는 사라진다.
test("the unified step copies app_notices rows as unread ephemeral app rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(noticeSchemaSteps[0]?.sql ?? "");
  db.prepare(
    "insert into app_notices (id, app, key, title, body, created_at) values (?, ?, ?, ?, ?, ?)",
  ).run(
    "ntc_1",
    APP,
    "limit",
    "Weekly limit",
    "resets Monday",
    "2026-11-05T00:00:00.000Z",
  );
  db.prepare(
    "insert into app_notices (id, app, key, title, body, created_at) values (?, ?, null, ?, '', ?)",
  ).run("ntc_2", OTHER, "Done", "2026-11-05T00:00:01.000Z");
  db.exec(noticeUnifiedSchemaSteps[0]?.sql ?? "");
  const rows = db
    .prepare(
      "select id, source, app, kind, key, title, body, persistent, action, read_at from notices order by id",
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepStrictEqual(rows, [
    {
      id: "ntc_1",
      source: "app",
      app: APP,
      kind: "app",
      key: "limit",
      title: "Weekly limit",
      body: "resets Monday",
      persistent: 0,
      action: null,
      read_at: null,
    },
    {
      id: "ntc_2",
      source: "app",
      app: OTHER,
      kind: "app",
      key: null,
      title: "Done",
      body: "",
      persistent: 0,
      action: null,
      read_at: null,
    },
  ]);
  assert.throws(() => db.prepare("select 1 from app_notices").get());
});

// lophn_updated는 판이 바뀐 기동에서만 한 번 남는다. 새 data root는 판만 적고 남기지 않는다.
test("the version marker records lophn_updated once per change and not on a fresh data root", () => {
  const s = setup();
  const rows = () =>
    s.db
      .prepare("select title, body from notices where kind = 'lophn_updated'")
      .all()
      .map((row) => ({ ...row }));

  assert.deepStrictEqual(
    s.observe("0.20.0", true),
    ok({ changed: false, from: null }),
  );
  assert.deepStrictEqual(rows(), []);
  // 같은 판으로 다시 켜도 남기지 않는다.
  assert.deepStrictEqual(
    s.observe("0.20.0", false),
    ok({ changed: false, from: "0.20.0" }),
  );
  assert.deepStrictEqual(rows(), []);

  assert.deepStrictEqual(
    s.observe("0.21.0", false),
    ok({ changed: true, from: "0.20.0" }),
  );
  assert.deepStrictEqual(rows(), [
    { title: "lophn was updated to 0.21.0", body: "It was 0.20.0 before." },
  ]);
  assert.deepStrictEqual(
    s.observe("0.21.0", false),
    ok({ changed: false, from: "0.21.0" }),
  );
  assert.deepStrictEqual(rows().length, 1);

  // 판을 적지 않던 옛 data root가 처음 켜질 때는 from을 모르는 채로 남긴다.
  const old = setup();
  assert.deepStrictEqual(
    old.observe("0.21.0", false),
    ok({ changed: true, from: null }),
  );
  assert.deepStrictEqual(
    old.db
      .prepare("select count(*) as n from notices where kind = 'lophn_updated'")
      .get()?.["n"],
    1,
  );
});

// SDK 감지를 돌릴 신호: 제품 판이 같아도 설치된 SDK 판이 바뀌면 true, 바뀐 것이 없으면 false다.
test("a changed SDK version is reported even when the product version is the same", () => {
  const s = setup();
  const v1 = { "app-ui": "2.6.0", ui: "1.0.0" };
  assert.strictEqual(s.observeSdks("0.21.0", true, v1), false);
  assert.strictEqual(s.observeSdks("0.21.0", false, v1), false);
  assert.strictEqual(
    s.observeSdks("0.21.0", false, { ...v1, "app-ui": "2.7.0" }),
    true,
  );
  assert.strictEqual(
    s.observeSdks("0.21.0", false, { ...v1, "app-ui": "2.7.0" }),
    false,
  );
  // SDK 판을 적지 않던 옛 data root가 처음 켜지면 한 번 돌린다.
  const old = setup();
  assert.strictEqual(old.observeSdks("0.21.0", false, v1), true);
});
