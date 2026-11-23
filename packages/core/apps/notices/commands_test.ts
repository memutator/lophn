import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  NOTICE_EPHEMERAL_PER_APP_MAX,
  NOTICE_PERSISTENT_PER_APP_MAX,
  type NoticeRecordInput,
  noticePost,
} from "../../../protocol/apps/notice.ts";
import type { AppSdkStatus } from "../../../protocol/apps/sdk-status.ts";
import {
  type WorkflowFlowSdkStatus,
  workspaceUpdateRecord,
} from "../../../protocol/apps/updates.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { DEFAULT_CALL_POLICY } from "../../../protocol/lophn-agent/call-policy.ts";
import type { AgentCallRow } from "../../../protocol/lophn-agent/calls.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  loadLastFlowSdkReview,
  loadLastPlatformReview,
  WORKSPACE_LIFECYCLE_SCHEMA_STEP,
} from "../../follow-ups/mod.ts";
import { installRouterEnvironment } from "../../router/environment.ts";
import type { TargetSession } from "../../router/ports.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import {
  UPDATE_RECORD_CONTEXT,
  updateRecordCommand,
} from "../sdk-status/decide.ts";
import {
  countWorkspaceUpdates,
  recordWorkspaceUpdates,
  WORKSPACE_UPDATE_NOTICE_KEY,
} from "../sdk-status/detect.ts";
import { sdkReviewSchemaSteps } from "../sdk-status/schema.ts";
import { clearAppNotices, createNoticeCommands } from "./commands.ts";
import { programNoticeText } from "./program-text.ts";
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

// fresh: true는 platform_reviews를 마지막 note ID로 시드하고, 기존 data root(fresh: false)는 시드하지 않는다.
test("observeVersion tracks platform_notes_changed and seeds platform_reviews only when fresh is true", () => {
  const withLifecycle = () => {
    const s = setup();
    for (const step of [
      ...sdkReviewSchemaSteps,
      WORKSPACE_LIFECYCLE_SCHEMA_STEP,
    ]) {
      s.db.exec(step.sql);
    }
    const commands = createNoticeCommands();
    const observe = (input: {
      version: string;
      fresh: boolean;
      platform_notes?: string[];
    }) =>
      commands.observeVersion.handle(
        s.tx,
        ctxOf("machine"),
        input,
        {} as never,
      );
    return { ...s, observe };
  };

  // 새 data root(fresh: true): 마지막 메모 ID로 platform_reviews를 시드하고 changed는 모두 false다.
  const fresh = withLifecycle();
  const r1 = fresh.observe({
    version: "0.24.0",
    fresh: true,
    platform_notes: ["note-1", "note-2"],
  });
  assert.ok(r1.ok);
  assert.deepStrictEqual(r1.value, {
    changed: false,
    from: null,
    sdks_changed: false,
    platform_notes_changed: false,
  });
  assert.strictEqual(loadLastPlatformReview(fresh.tx.sql)?.through, "note-2");

  // 같은 notes로 재기동하면 platform_notes_changed는 false다.
  const r2 = fresh.observe({
    version: "0.24.0",
    fresh: false,
    platform_notes: ["note-1", "note-2"],
  });
  assert.ok(r2.ok);
  assert.strictEqual(r2.value.platform_notes_changed, false);

  // 새 note가 붙으면 platform_notes_changed가 true가 되고 platform_reviews는 덮어쓰지 않는다.
  const r3 = fresh.observe({
    version: "0.24.0",
    fresh: false,
    platform_notes: ["note-1", "note-2", "note-3"],
  });
  assert.ok(r3.ok);
  assert.strictEqual(r3.value.platform_notes_changed, true);
  assert.strictEqual(loadLastPlatformReview(fresh.tx.sql)?.through, "note-2");

  // 기존 data root 업그레이드(fresh: false): platform_reviews를 시드하지 않고 platform_notes_changed는 true다.
  const upgrading = withLifecycle();
  const u1 = upgrading.observe({
    version: "0.24.0",
    fresh: false,
    platform_notes: ["note-1", "note-2"],
  });
  assert.ok(u1.ok);
  assert.strictEqual(u1.value.changed, true);
  assert.strictEqual(u1.value.platform_notes_changed, true);
  assert.strictEqual(loadLastPlatformReview(upgrading.tx.sql), null);
});

// workspace_update_needed는 required 건수를 강조하고, 모든 5종 건수가 0이 되면 행을 지우지 않고 읽음으로 닫는다.
test("workspace_update_needed formats required counts prominently and auto-resolves to read when all counts hit zero", async () => {
  const s = setup();
  const textWithRequired = programNoticeText({
    kind: "workspace_update_needed",
    params: {
      required_apps: 2,
      required_workflows: 1,
      unreviewed_apps: 1,
      unreviewed_workflows: 0,
      unreviewed_notes: 3,
    },
  });
  assert.strictEqual(textWithRequired.title, "Workspace updates (3 required)");
  assert.strictEqual(
    textWithRequired.body,
    "Required: 2 apps, 1 workflow must update. Unreviewed: 1 app, 3 platform updates.",
  );

  const textNoRequired = programNoticeText({
    kind: "workspace_update_needed",
    params: {
      required_apps: 0,
      required_workflows: 0,
      unreviewed_apps: 1,
      unreviewed_workflows: 2,
      unreviewed_notes: 1,
    },
  });
  assert.strictEqual(textNoRequired.title, "Workspace updates available");
  assert.strictEqual(
    textNoRequired.body,
    "Unreviewed: 1 app, 2 workflows, 1 platform update.",
  );

  // 열린 알림이 없을 때 all-zero는 조용히 건너뛰고 행을 만들지 않는다.
  const record = async (input: NoticeRecordInput) => s.record("machine", input);
  const noop = await recordWorkspaceUpdates(
    { apps: [], workflows: [], unreviewedNotes: 0 },
    record,
  );
  assert.strictEqual(noop, null);
  assert.strictEqual(s.count(), 0);

  // 5종 건수 집계 + 알림 생성
  const makeApp = (
    name: string,
    level: "required" | "available" | "current",
    unreviewed: string[] = level === "current" ? [] : ["agent-2.0.0.md"],
  ): AppSdkStatus =>
    ({
      app: `app_${name}`,
      name,
      release: "rel_1",
      sdks: [
        {
          sdk: "@lophn/agent",
          pinned: "1.0.0",
          current: "2.0.0",
          supported_from: "2.0.0",
          level,
          notes: [],
          unreviewed,
        },
      ],
      review: null,
    }) as unknown as AppSdkStatus;

  const makeWf = (
    name: string,
    level: "required" | "available" | "current",
    reviewedThrough: string | null = null,
  ): WorkflowFlowSdkStatus => ({
    project: "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">,
    project_name: "Alpha",
    workflow: name,
    flow_sdk:
      level === "required"
        ? "1.0.0"
        : level === "available"
          ? "2.0.0"
          : "2.1.0",
    current: "2.1.0",
    supported_from: "2.0.0",
    level,
    note: level === "current" ? null : "flow-2.1.0.md",
    reviewed_through: reviewedThrough,
    review_decision: reviewedThrough === null ? null : "leave",
  });

  const counts = countWorkspaceUpdates({
    apps: [
      makeApp("Broken", "required"),
      makeApp("Avail", "available"),
      makeApp("Left", "available", []),
      makeApp("Ok", "current"),
    ],
    workflows: [
      makeWf("old-flow", "required"),
      makeWf("avail-flow", "available", null),
      makeWf("left-flow", "available", "2.1.0"),
      makeWf("ok-flow", "current"),
    ],
    unreviewedNotes: 2,
  });
  assert.deepStrictEqual(counts, {
    required_apps: 1,
    required_workflows: 1,
    unreviewed_apps: 1,
    unreviewed_workflows: 1,
    unreviewed_notes: 2,
  });

  const posted = await recordWorkspaceUpdates(
    {
      apps: [makeApp("Broken", "required")],
      workflows: [makeWf("old-flow", "required")],
      unreviewedNotes: 1,
    },
    record,
  );
  assert.ok(posted !== null && posted.ok);
  assert.strictEqual(
    s.count("kind = 'workspace_update_needed' and read_at is null"),
    1,
  );
  const openRow = s.db
    .prepare(
      "select key, action from notices where kind = 'workspace_update_needed'",
    )
    .get() as { key: string; action: string };
  assert.strictEqual(openRow.key, WORKSPACE_UPDATE_NOTICE_KEY);
  assert.deepStrictEqual(JSON.parse(openRow.action), {
    kind: "open_home_skill",
    skill: "update",
    args: "",
  });

  // 모든 5종 건수가 0이 되면 행은 유지한 채 read_at만 채우고 NoticeRead를 낸다.
  s.pushed.length = 0;
  const resolved = await recordWorkspaceUpdates(
    { apps: [makeApp("Ok", "current")], workflows: [], unreviewedNotes: 0 },
    record,
  );
  assert.ok(resolved !== null && resolved.ok);
  assert.strictEqual(
    s.count("kind = 'workspace_update_needed' and read_at is null"),
    0,
  );
  assert.strictEqual(
    s.count("kind = 'workspace_update_needed' and read_at is not null"),
    1,
  );
  assert.ok(s.pushed.some((event) => event.type === "NoticeRead"));
});

// update.record는 app_sdk·flow_sdk·platform 결정을 한 Tx에서 검증·인계·기록하며, handoff가 거절되면 아무 행도 남기지 않는다.
test("updateRecordCommand atomically records app_sdk, flow_sdk, and platform decisions and leaves no rows on refusal", () => {
  const PROJECT = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
  const SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"ses">;
  const TURN = "trn_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"trn">;
  const FUP_1 = "fup_01hzzzzzzzzzzzzzzzzzzzzzz1" as Id<"fup">;
  const FUP_2 = "fup_01hzzzzzzzzzzzzzzzzzzzzzz2" as Id<"fup">;
  const FUP_3 = "fup_01hzzzzzzzzzzzzzzzzzzzzzz3" as Id<"fup">;
  const FUP_4 = "fup_01hzzzzzzzzzzzzzzzzzzzzzz4" as Id<"fup">;

  const setupWorld = (refuse: boolean) => {
    const db = new DatabaseSync(":memory:");
    for (const step of [
      ...appsSchemaSteps,
      ...sdkReviewSchemaSteps,
      WORKSPACE_LIFECYCLE_SCHEMA_STEP,
    ]) {
      db.exec(step.sql);
    }
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL
      ) STRICT;
    `);
    db.prepare(
      `insert into apps (id, slug, name, description, run_enabled, revision, status)
       values (?, 'usage', 'Usage', 'tracks usage', 1, '1', 'active')`,
    ).run(APP);
    db.prepare(
      "insert into projects (id, name, status) values (?, 'Alpha', 'active')",
    ).run(PROJECT);

    const calls = new Map<string, AgentCallRow>();
    const routedTargets: unknown[] = [];
    let targetSeq = 1;
    const makeTarget = (): TargetSession => ({
      session:
        `ses_01hzzzzzzzzzzzzzzzzzzzzz${String(targetSeq++).padStart(2, "0")}` as TargetSession["session"],
      transport: "lophn",
      agent: { agent: "lophn_home", workspace: null },
      accepting: true,
      open: true,
      spawned_by: null,
      opened_by_machine: null,
      runs_on: null,
    });

    installRouterEnvironment({
      unattendedTurn: () => false,
      deps: () => ({
        callPolicy: () => DEFAULT_CALL_POLICY,
        announce: () => {},
        directory: {
          find: () => makeTarget(),
          resolveAddress: (address) => {
            routedTargets.push(address);
            return refuse
              ? err({ code: "forbidden" as const, message: "blocked" })
              : ok({ agent: "lophn_home", workspace: null });
          },
          archive: () => ok(false),
          membersOn: () => [],
          membersFrom: () => [],
          membersUnder: () => [],
          setWorkflowOrigin: () => {},
          openMember: () =>
            err({ code: "forbidden", message: "not in this test" }),
          open: () => ok(makeTarget()),
          accepts: () => null,
          listOpen: () => [],
          app: () => null,
          projectOfIdentity: () => null,
          identityOfProject: () => ok("pri_test"),
          appIdOf: () => err({ code: "not_found", message: "app not found" }),
        },
        outbox: {} as never,
        seen: {} as never,
        self: () => "mch_self",
        steps: {} as never,
        transport: {
          deliver: () => ok(undefined),
          cancel: () => ok(undefined),
          withdraw: () => ok(undefined),
        },
        store: {
          insert: (_tx, record) => {
            calls.set(record.call, record);
            return ok(undefined);
          },
          byDedup: () => null,
          read: (_tx, call) => calls.get(call) ?? null,
          memberCall: () => null,
          move: (_tx, call, to, reason) => {
            const moved = {
              ...calls.get(call)!,
              state: to,
              fail_reason: reason,
            };
            calls.set(call, moved);
            return ok(moved);
          },
          consumed: () => true,
          markConsumed: () => ok(undefined),
          setDelivery: () => ok(undefined),
          lost: () => [],
          openReceivedBy: () => [],
          openAsksSentBy: () => [],
          openSentFromRemote: () => [],
        },
      }),
    });

    let idSeq = 1;
    const sql = {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    };
    const tx = {
      sql,
      now: () => "2026-11-23T00:00:00.000Z",
      newId: (prefix: string) =>
        `${prefix}_${String(idSeq++).padStart(26, "0")}`,
      port: () => ({ principal: () => UPDATE_RECORD_CONTEXT.principal }),
    } as unknown as Tx;
    const count = (table: string) =>
      Number(db.prepare(`select count(*) as n from ${table}`).get()!["n"]);
    return { db, sql, tx, count, routedTargets };
  };

  const cmd = updateRecordCommand as unknown as CommandDefinition<
    typeof workspaceUpdateRecord
  >;

  const operations = [
    {
      kind: "app_sdk" as const,
      app: APP as Id<"app">,
      decision: "update" as const,
      through: { "@lophn/agent": "1.18.0" },
      items: [
        {
          id: FUP_1,
          title: "Use app files",
          proposal: "Adopt app files API.",
          source_ref: "agent-1.18.0.md",
        },
      ],
      body: [{ type: "text" as const, text: "app handoff" }],
    },
    {
      kind: "flow_sdk" as const,
      project: PROJECT,
      workflow: "nightly-sync",
      decision: "update" as const,
      through: "2.0.0",
      items: [
        {
          id: FUP_2,
          title: "Upgrade flow to 2.0",
          proposal: "Use step(key, fn).",
          source_ref: "flow-2.0.0.md",
        },
      ],
      body: [{ type: "text" as const, text: "flow handoff" }],
    },
    {
      kind: "platform" as const,
      through: "durable-workflows-and-flow-2",
      handoffs: [
        {
          workspace: null,
          items: [
            {
              id: FUP_3,
              title: "Review global custom agent",
              proposal: "Update instructions.",
              source_ref: "durable-workflows-and-flow-2",
            },
          ],
          body: [{ type: "text" as const, text: "home platform handoff" }],
        },
        {
          workspace: { kind: "project" as const, id: PROJECT },
          items: [
            {
              id: FUP_4,
              title: "Clean up project memory.md",
              proposal: "Drop old workaround.",
              source_ref: "durable-workflows-and-flow-2",
            },
          ],
          body: [{ type: "text" as const, text: "project platform handoff" }],
        },
      ],
    },
  ];

  // 거절 시 어떤 review·follow_up 행도 남지 않는다.
  const refused = setupWorld(true);
  const failed = cmd.handle(
    refused.tx,
    UPDATE_RECORD_CONTEXT,
    { session: SESSION, turn: TURN, operations },
    {} as never,
  );
  assert.strictEqual(failed.ok, false);
  assert.deepStrictEqual(
    [
      refused.count("sdk_reviews"),
      refused.count("flow_sdk_reviews"),
      refused.count("platform_reviews"),
      refused.count("follow_up_items"),
    ],
    [0, 0, 0, 0],
  );

  // agent 호출: app_sdk + flow_sdk + platform(project)만 라우팅하고 Home(workspace: null)은 자기 자신에게 중복 call을 보내지 않는다.
  const accepted = setupWorld(false);
  const res = cmd.handle(
    accepted.tx,
    UPDATE_RECORD_CONTEXT,
    { session: SESSION, turn: TURN, operations },
    {} as never,
  );
  assert.ok(res.ok);
  assert.strictEqual(res.value.follow_ups.length, 4);
  assert.strictEqual(res.value.calls.length, 3);
  assert.strictEqual(accepted.routedTargets.length, 3);
  assert.strictEqual(accepted.count("sdk_reviews"), 1);
  assert.strictEqual(accepted.count("flow_sdk_reviews"), 1);
  assert.strictEqual(accepted.count("platform_reviews"), 1);
  assert.strictEqual(accepted.count("follow_up_items"), 4);
  assert.strictEqual(
    loadLastFlowSdkReview(accepted.sql, PROJECT, "nightly-sync")?.through,
    "2.0.0",
  );
  assert.strictEqual(
    loadLastPlatformReview(accepted.sql)?.through,
    "durable-workflows-and-flow-2",
  );

  // user 호출(session: null): platform(workspace: null)도 Home lophn으로 message를 라우팅해 handoff_sessions에 싣는다.
  const byUser = setupWorld(false);
  const userRes = cmd.handle(
    byUser.tx,
    UPDATE_RECORD_CONTEXT,
    {
      session: null,
      turn: null,
      operations: [
        {
          kind: "platform" as const,
          through: "coding-agent-harness-profiles",
          handoffs: [
            {
              workspace: null,
              items: [
                {
                  id: FUP_3,
                  title: "Review Home custom agents",
                  proposal: "Check harness profiles.",
                },
              ],
              body: [{ type: "text" as const, text: "home handoff from user" }],
            },
          ],
        },
      ],
    },
    {} as never,
  );
  assert.ok(userRes.ok);
  assert.strictEqual(userRes.value.calls.length, 0);
  assert.strictEqual(userRes.value.handoff_sessions.length, 1);
  assert.strictEqual(byUser.routedTargets.length, 1);
});
