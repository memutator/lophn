import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import { appDelete } from "../../../../protocol/apps/mod.ts";
import { quickLaunchSetting } from "../../../config/shell-settings.ts";
import type { WiringContext } from "./context.ts";
import { appsDeleteWiring } from "./apps-delete.ts";

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

    let settings: Record<string, unknown> = {
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
