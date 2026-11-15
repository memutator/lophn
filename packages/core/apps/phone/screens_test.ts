import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { createScreenFileDeps } from "../screens/mod.ts";
import { readPhoneScreens } from "./screens.ts";

const id = (prefix: string, letter: string) =>
  `${prefix}_01${letter.repeat(24)}`;
const MANIFEST = JSON.stringify({
  format: 1,
  entry: "phone.js",
  size: 1,
  sha256: "e".repeat(64),
  base: 1,
  kit: { "@lophn/ui-native": "1.0.0", "@lophn/app-ui-native": "1.0.0" },
  modules: ["react"],
});

// 폰에 가는 화면은 사람이 보는 앱(보관하지 않음, 켜진 release 있음)의 phone 화면 가운데 bundle 사본 안에 맞는 manifest가 있는 것뿐이다.
// manifest 경로는 앱 코드가 정하는 screen key를 지나므로 `..`나 밖을 가리키는 symlink로 bundle 밖 file을 싣지 못해야 한다.
test("phone_screens는 보관한 앱, 켜진 release 없는 앱, phone 아닌 화면, bundle 밖 manifest를 싣지 않는다", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-phone-screens-"));
  try {
    const db = new DatabaseSync(":memory:");
    for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
      db.exec(step.sql);
    }
    const sql = {
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as never,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as never,
    };
    const phone = (key: string) => ({
      key,
      label: key,
      path: `/${key}`,
      places: ["phone"],
    });
    let n = 0;
    const add = (
      app: string,
      status: "active" | "archived",
      release: string,
      screens: unknown[],
    ) => {
      n += 1;
      db.prepare(
        `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
         VALUES (?, ?, ?, 'does things', ?, '1', ?)`,
      ).run(app, `app${n}`, `App ${n}`, status === "active" ? 1 : 0, status);
      db.prepare(
        `INSERT INTO releases (id, app, number, code_commit, bundle_hash, declaration_hash,
           data_schema, data_changes, created_by, created_at, status, activated_at, declaration, facts)
         VALUES (?, ?, 1, ?, ?, ?, 0, '[]', 'user', '2026-01-01T00:00:00.000Z', ?, ?, ?, '{}')`,
      ).run(
        id("rel", String(n)),
        app,
        "c".repeat(40),
        "b".repeat(64),
        "d".repeat(64),
        release,
        release === "active" ? "2026-01-01T00:00:00.000Z" : null,
        JSON.stringify({ icon: "lucide:star", screens }),
      );
    };
    const good = id("app", "a");
    const second = id("app", "b");
    add(good, "active", "active", [
      phone("main"),
      phone("broken"),
      phone("../../../outside"),
      phone("linked"),
      { ...phone("desk"), places: ["tab"] },
    ]);
    add(second, "active", "active", [phone("main")]);
    add(id("app", "c"), "archived", "active", [phone("main")]);
    add(id("app", "d"), "active", "prepared", [phone("main")]);
    add(id("app", "e"), "active", "active", [
      { ...phone("main"), places: ["tab"] },
    ]);

    // 앱마다 bundle 사본(<tmp>/bundles/<app>). <tmp>/outside는 manifest가 맞아도 bundle 밖이다.
    await mkdir(join(tmp, "outside"));
    await writeFile(join(tmp, "outside/phone.json"), MANIFEST);
    for (const app of [good, second, id("app", "c"), id("app", "d")]) {
      await mkdir(join(tmp, "bundles", app, "screens/main"), {
        recursive: true,
      });
      await writeFile(
        join(tmp, "bundles", app, "screens/main/phone.json"),
        MANIFEST,
      );
    }
    await mkdir(join(tmp, "bundles", good, "screens/broken"));
    await writeFile(
      join(tmp, "bundles", good, "screens/broken/phone.json"),
      "{}",
    );
    await mkdir(join(tmp, "bundles", good, "screens/desk"));
    await writeFile(
      join(tmp, "bundles", good, "screens/desk/phone.json"),
      MANIFEST,
    );
    await symlink(
      join(tmp, "outside"),
      join(tmp, "bundles", good, "screens/linked"),
      "junction",
    );
    const read = await readPhoneScreens(
      {
        ...createScreenFileDeps({
          dir: (target) => ok(join(tmp, "bundles", target.app)),
        }),
        running: (app) => Promise.resolve(app === good),
      },
      sql,
    );
    assert.ok(read.ok);
    assert.deepStrictEqual(
      read.value.screens.map((s) => [s.app, s.screen, s.running]),
      [
        [good, "main", true],
        [second, "main", false],
      ],
    );
    assert.deepStrictEqual(read.value.screens[0].icon, "lucide:star");
    assert.deepStrictEqual(read.value.screens[0].release, id("rel", "1"));
    assert.deepStrictEqual(read.value.screens[0].bundle_hash, "b".repeat(64));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
