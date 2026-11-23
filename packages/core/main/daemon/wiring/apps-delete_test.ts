import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createIdSource, ok } from "../../../../base/mod.ts";
import { appDelete } from "../../../../protocol/apps/mod.ts";
import type { FollowUpItem, Id } from "../../../../protocol/base/mod.ts";
import {
  sendMessage,
  workspaceSessionOpen,
} from "../../../../protocol/lophn-agent/mod.ts";
import { quickLaunchSetting } from "../../../config/shell-settings.ts";
import {
  listFollowUps,
  WORKSPACE_LIFECYCLE_SCHEMA_STEP,
} from "../../../follow-ups/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { appsDeleteWiring } from "./apps-delete.ts";
import { cascadeWiring } from "./cascade.ts";
import type { WiringContext } from "./context.ts";

const GONE = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const KEPT = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

// 지운 앱의 폴더(읽기 전용 하위 폴더 포함)와 고정이 사라지고, 다른 앱과 secret 파일은 그대로다.
test("app.delete가 끝나면 그 앱의 폴더와 고정만 지워지고 다른 앱과 secret은 남는다", async () => {
  const root = await mkdtemp(`${tmpdir()}/lophn-app-delete-`);
  try {
    for (const app of [GONE, KEPT]) {
      await mkdir(`${root}/apps/${app}/bundles/h`, { recursive: true });
      await writeFile(`${root}/apps/${app}/bundles/h/index.js`, "x");
    }
    await chmod(`${root}/apps/${GONE}/bundles/h`, 0o555);
    await writeFile(`${root}/secrets.json`, "{}");

    const settings: Record<string, unknown> = {
      [quickLaunchSetting.key]: {
        order: [`pin:${GONE}:main`, `pin:${KEPT}:main`],
        apps: [
          { app: GONE, surface: "main" },
          { app: KEPT, surface: "main" },
        ],
      },
    };
    const forgotten: string[] = [];
    const wiring = appsDeleteWiring();
    const built = await wiring.build!({
      telemetry: { logger: { error: () => {} } },
      root: { path: root },
      bus: { publish: () => {} },
      clock: { now: () => "2026-02-01T00:00:00.000Z" },
      appsControl: {
        facts: { app: () => Promise.resolve(ok(null)) },
        previews: { current: () => Promise.resolve(ok(null)) },
        forget: (app: string) => forgotten.push(app),
      },
      rewindFiles: { store: { removeSession: () => Promise.resolve() } },
      settings: { get: (setting: { key: string }) => settings[setting.key] },
      settingsUpdate: (
        changes: { key: string; action: string; value: unknown }[],
      ) => {
        for (const change of changes) settings[change.key] = change.value;
        return ok({ rejected: [] });
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);
    const writer = built.value.writer!({
      command: () =>
        Promise.resolve(
          ok({
            result: { id: GONE, slug: "gone", sessions: [] },
            replayed: false,
          }),
        ),
    } as never);
    const done = await writer.command(
      {} as never,
      {
        command: appDelete.name,
        input: { app: GONE },
      } as never,
    );
    assert.ok(done.ok);

    assert.strictEqual(await exists(`${root}/apps/${GONE}`), false);
    assert.strictEqual(
      await exists(`${root}/apps/${KEPT}/bundles/h/index.js`),
      true,
    );
    assert.strictEqual(await exists(`${root}/secrets.json`), true);
    assert.deepStrictEqual(forgotten, [GONE]);
    assert.deepStrictEqual(settings[quickLaunchSetting.key], {
      order: [`pin:${KEPT}:main`],
      apps: [{ app: KEPT, surface: "main" }],
    });
  } finally {
    await chmod(`${root}/apps/${GONE}/bundles/h`, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

// 보관한 앱의 process가 아직 살아 있으면 지우기는 시작하지 않는다.
test("supervisor가 이 앱의 process를 아직 갖고 있으면 app.delete는 unavailable이고 폴더가 남는다", async () => {
  const root = await mkdtemp(`${tmpdir()}/lophn-app-delete-`);
  try {
    await mkdir(`${root}/apps/${GONE}`, { recursive: true });
    let innerCalled = false;
    const built = await appsDeleteWiring().build!({
      telemetry: { logger: { error: () => {} } },
      root: { path: root },
      bus: { publish: () => {} },
      clock: { now: () => "2026-02-01T00:00:00.000Z" },
      appsControl: {
        facts: { app: () => Promise.resolve(ok({ status: "archived" })) },
        previews: { current: () => Promise.resolve(ok(null)) },
        client: {
          observe: () =>
            Promise.resolve(ok({ process_nonce: "n1", app: GONE })),
        },
        forget: () => {},
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);
    const writer = built.value.writer!({
      command: () => {
        innerCalled = true;
        return Promise.resolve(ok({ result: {}, replayed: false }));
      },
    } as never);
    const done = await writer.command(
      {} as never,
      {
        command: appDelete.name,
        input: { app: GONE },
      } as never,
    );
    assert.ok(!done.ok);
    assert.strictEqual(done.error.code, "unavailable");
    assert.strictEqual(innerCalled, false);
    assert.strictEqual(await exists(`${root}/apps/${GONE}`), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function setupCascadeLedger(ledgerPath: string, withSecondConsumer: boolean) {
  const opened = openConnection(ledgerPath);
  assert.ok(opened.ok);
  const { sql } = opened.value;
  try {
    opened.value.exec(`
      CREATE TABLE apps (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        planning_version TEXT,
        source_path TEXT,
        active_release TEXT,
        revision TEXT NOT NULL,
        run_enabled INTEGER NOT NULL,
        status TEXT NOT NULL
      ) STRICT;
      CREATE TABLE app_folders (
        app TEXT NOT NULL,
        position INTEGER NOT NULL,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE TABLE releases (
        id TEXT PRIMARY KEY NOT NULL,
        app TEXT NOT NULL,
        number INTEGER NOT NULL,
        code_commit TEXT NOT NULL,
        bundle_hash TEXT NOT NULL,
        declaration_hash TEXT NOT NULL,
        data_schema INTEGER NOT NULL,
        data_changes TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        activation TEXT,
        activated_at TEXT,
        failure TEXT,
        declaration TEXT NOT NULL,
        facts TEXT NOT NULL
      ) STRICT;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE project_folders (
        project TEXT NOT NULL,
        position INTEGER NOT NULL,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        creator_agent TEXT NOT NULL,
        creator_workspace TEXT,
        every TEXT,
        at TEXT,
        trigger TEXT,
        action TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sdk_reviews (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE sdk_features (
        id TEXT PRIMARY KEY NOT NULL,
        review TEXT NOT NULL,
        app TEXT NOT NULL,
        title TEXT NOT NULL,
        proposal TEXT NOT NULL,
        note_file TEXT NOT NULL,
        state TEXT NOT NULL,
        outcome TEXT,
        state_at TEXT NOT NULL
      ) STRICT;
    `);
    opened.value.exec(WORKSPACE_LIFECYCLE_SCHEMA_STEP.sql);

    sql.run(
      `INSERT INTO apps VALUES (?, 'gone', 'Gone App', 'Gone', NULL, NULL, NULL, '1', 0, 'archived')`,
      [GONE],
    );
    sql.run(
      `INSERT INTO apps VALUES (?, 'kept', 'Kept App', 'Kept', NULL, NULL, 'rel_01hzzzzzzzzzzzzzzzzzzzzzzb', '1', 1, 'active')`,
      [KEPT],
    );
    const keptDecl = {
      name: "Kept App",
      description: "Kept",
      screens: [],
      operations: [],
      commands: [],
      app_connections: [
        { app: "gone", commands: ["sync"], reason: "pulls items from gone" },
      ],
      subscriptions: [],
    };
    sql.run(
      `INSERT INTO releases VALUES (
        'rel_01hzzzzzzzzzzzzzzzzzzzzzzb', ?, 1,
        '0000000000000000000000000000000000000000',
        '${"a".repeat(64)}', '${"b".repeat(64)}', 0, '[]', 'user',
        '2026-02-01T00:00:00.000Z', 'active', NULL, '2026-02-01T00:00:00.000Z', NULL, ?, '{}'
      )`,
      [KEPT, JSON.stringify(keptDecl)],
    );
    sql.run(
      `INSERT INTO jobs VALUES (
        'job_01hzzzzzzzzzzzzzzzzzzzzzza', 'Sync gone', 'lophn_home', ?,
        '1h', NULL, NULL, ?, 1, NULL, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
      )`,
      [
        withSecondConsumer ? null : KEPT,
        JSON.stringify({ kind: "tool_run", app: GONE, tool: "sync" }),
      ],
    );
  } finally {
    opened.value.close();
  }
}

test("app.delete의 clean_up=later와 clean_up=now(단일 그릇 직행 / 복수 그릇 Home 경유)가 follow-up과 handoff를 만든다", async () => {
  for (const scenario of [
    { name: "later-single", cleanUp: "later" as const, multi: false },
    { name: "now-single", cleanUp: "now" as const, multi: false },
    { name: "now-multi", cleanUp: "now" as const, multi: true },
  ]) {
    const root = await mkdtemp(`${tmpdir()}/lophn-cascade-${scenario.name}-`);
    try {
      const ledgerPath = `${root}/lophn.db`;
      setupCascadeLedger(ledgerPath, scenario.multi);

      const delivered: { command: string; input: unknown }[] = [];
      const clock = {
        now: () => "2026-02-01T00:00:00.000Z",
        nowMs: () => Date.parse("2026-02-01T00:00:00.000Z"),
      };
      let n = 1;
      const random = {
        fill(bytes: Uint8Array) {
          bytes.fill(n++);
        },
      };
      const ids = createIdSource({ clock, random });
      const cascade = cascadeWiring();
      const ctx = {
        ledgerPath,
        root: { path: root },
        clock,
        random,
        bus: { publish: () => {} },
        peek: {},
        telemetry: { logger: { warn: () => {}, error: () => {} } },
        writer: {
          command: (
            _auth: unknown,
            env: { command: string; input: unknown },
          ) => {
            delivered.push({ command: env.command, input: env.input });
            if (env.command === workspaceSessionOpen.name) {
              const id = (env.input as { id?: string }).id ?? ids.newId("ses");
              return Promise.resolve(ok({ result: { id }, replayed: false }));
            }
            return Promise.resolve(ok({ result: {}, replayed: false }));
          },
        },
      } as unknown as WiringContext;

      const built = await cascade.build!(ctx);
      assert.ok(built.ok);
      const wrapped = built.value.writer!({
        command: () =>
          Promise.resolve(
            ok({
              result: { id: GONE, slug: "gone", sessions: [] },
              replayed: false,
            }),
          ),
      } as never);

      const done = await wrapped.command(
        {
          actor: "user",
          principal: "user:local",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "user",
        } as never,
        {
          command: appDelete.name,
          input: { app: GONE, clean_up: scenario.cleanUp },
        } as never,
      );
      assert.ok(done.ok);
      const res = done.value.result as {
        follow_ups: FollowUpItem[];
        handoff_session: Id<"ses"> | null;
        erased_jobs?: { id: string; title: string; summary: string }[];
      };

      const expectedCount = scenario.multi ? 2 : 1;
      assert.strictEqual(res.follow_ups.length, expectedCount);
      assert.strictEqual(res.erased_jobs?.length, 1);

      const opened = openConnection(ledgerPath);
      assert.ok(opened.ok);
      const stored = listFollowUps(opened.value.sql, { origin: "cascade" });
      opened.value.close();
      assert.strictEqual(stored.length, expectedCount);
      for (const item of stored) {
        assert.strictEqual(item.state, "open");
        assert.strictEqual(item.source_ref, `app:${GONE}`);
        assert.ok(item.body.includes("LOPHN.md"));
        assert.ok(item.body.includes("memory.md"));
        assert.ok(item.body.includes("[Resume with updated code]"));
        assert.ok(item.body.includes(`lophn follow-up report ${item.id}`));
        assert.ok(item.body.includes("Sync gone"));
      }

      if (scenario.cleanUp === "later") {
        assert.strictEqual(res.handoff_session, null);
        assert.strictEqual(delivered.length, 0);
      } else {
        assert.notStrictEqual(res.handoff_session, null);
        const openCmd = delivered.find(
          (d) => d.command === workspaceSessionOpen.name,
        );
        const sendCmd = delivered.find((d) => d.command === sendMessage.name);
        assert.ok(openCmd !== undefined);
        assert.ok(sendCmd !== undefined);
        const openInput = openCmd.input as {
          agent: string;
          workspace: { kind: string; id: string } | null;
        };
        if (scenario.multi) {
          assert.strictEqual(openInput.agent, "lophn_home");
          assert.strictEqual(openInput.workspace, null);
        } else {
          assert.strictEqual(openInput.agent, `lophn_${KEPT}`);
          assert.deepStrictEqual(openInput.workspace, {
            kind: "app",
            id: KEPT,
          });
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
