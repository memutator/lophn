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
import { readPhoneFile } from "./files.ts";

const APP = `app_01${"a".repeat(24)}`;
const ACTIVE = `rel_01${"1".repeat(24)}`;
const OLD = `rel_01${"2".repeat(24)}`;

// 폰이 받는 file은 그 release의 backend.json이 적은 것뿐이다. 경로는 폰이 정하므로 `..`, 다른 화면 file,
// node_modules, bundle 밖을 가리키는 symlink, 활성이 아닌 release로는 아무것도 받지 못해야 한다.
test("phone_file은 backend.json이 적은 file만 주고 목록 밖 path와 활성이 아닌 release는 not_found다", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-phone-file-"));
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
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
       VALUES (?, 'app', 'App', 'does things', 1, '1', 'active')`,
    ).run(APP);
    for (const [release, number, status] of [
      [ACTIVE, 2, "active"],
      [OLD, 1, "superseded"],
    ] as const) {
      db.prepare(
        `INSERT INTO releases (id, app, number, code_commit, bundle_hash, declaration_hash,
           data_schema, data_changes, created_by, created_at, status, activated_at, declaration, facts)
         VALUES (?, ?, ?, ?, ?, ?, 0, '[]', 'user', '2026-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', '{}', '{}')`,
      ).run(
        release,
        APP,
        number,
        "c".repeat(40),
        "b".repeat(64),
        "d".repeat(64),
        status,
      );
    }
    const backend = JSON.stringify({
      format: 1,
      entry: "backend.js",
      size: 1,
      sha256: "a".repeat(64),
      data_schema: 1,
      migrations: [
        {
          from: 0,
          to: 1,
          file: "migrations/0-1.sql",
          sha256: "a".repeat(64),
        },
      ],
      operations: { list: "read" },
      sdk: { "@lophn/cap-store": "2.0.0", "@lophn/cap-tool": "2.2.0" },
    });
    const bundle = join(tmp, "bundle");
    for (const dir of [
      "phone",
      "migrations",
      "screens/home",
      "node_modules/x",
    ]) {
      await mkdir(join(bundle, dir), { recursive: true });
    }
    for (const [path, text] of [
      ["phone/backend.js", "js"],
      ["phone/backend.json", backend],
      ["phone/backend.js.map", "map"],
      ["migrations/0-1.sql", "sql"],
      ["migrations/1-2.sql", "unlisted"],
      ["screens/home/phone.js", "screen"],
      ["node_modules/x/index.js", "module"],
    ]) {
      await writeFile(join(bundle, path), text);
    }
    await writeFile(join(tmp, "secret.txt"), "secret");
    await symlink(
      join(tmp, "secret.txt"),
      join(bundle, "migrations/0-1.sql.bak"),
    );
    const deps = createScreenFileDeps({ dir: () => ok(bundle) });
    const read = (release: string, path: string) =>
      readPhoneFile(deps, sql, {
        app: APP as never,
        release: release as never,
        path,
      });

    for (const [path, text] of [
      ["phone/backend.js", "js"],
      ["phone/backend.json", backend],
      ["migrations/0-1.sql", "sql"],
    ]) {
      const served = await read(ACTIVE, path);
      assert.ok(served.ok, path);
      assert.equal(new TextDecoder().decode(served.value.bytes), text);
    }
    for (const path of [
      "../secret.txt",
      "phone/../../secret.txt",
      "phone/backend.js.map",
      "migrations/1-2.sql",
      "migrations/0-1.sql.bak",
      "screens/home/phone.js",
      "node_modules/x/index.js",
    ]) {
      const served = await read(ACTIVE, path);
      assert.ok(!served.ok && served.error.code === "not_found", path);
    }
    const old = await read(OLD, "phone/backend.js");
    assert.ok(!old.ok && old.error.code === "not_found");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
