// 앱 템플릿 모양의 앱이 data worker로 schema 0 → 1을 migration한다(apps/data#R6, R8). 단계 파일은 템플릿의
// `migrations/<from>-<to>.sql`이고 release.prepare의 data_changes(`dataChangesOf`)가 같은 byte의 hash를 낸다.
// 사람 데이터 root는 열지 않는다. root는 temp 폴더다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../../../packages/base/mod.ts";
import {
  decodeDataJobOutput,
  encodeDataJobInput,
} from "../../../packages/protocol/apps/mod.ts";
import { dataChangesOf } from "../../../packages/core/apps/releases/activation/desired.ts";
import { runDataJobLine } from "./data.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const INVOCATION = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const BUNDLE_HASH = "b".repeat(64);

async function template(): Promise<string> {
  return await Deno.readTextFile(
    new URL(
      "../../../packages/core/apps/packages/template/app/migrations/0-1.sql.tmpl",
      import.meta.url,
    ),
  );
}

type Setup = { root: string; bundle: string; data: string };

async function setup(sql: string): Promise<Setup> {
  const root = await Deno.makeTempDir({ prefix: "lophn-data-worker-" });
  const bundle = `${root}/apps/${APP}/bundles/${BUNDLE_HASH}`;
  await Deno.mkdir(`${bundle}/migrations`, { recursive: true });
  await Deno.mkdir(`${root}/apps/${APP}/data`, { recursive: true });
  await Deno.writeTextFile(`${bundle}/migrations/0-1.sql`, sql);
  return { root, bundle, data: `${root}/apps/${APP}/data` };
}

function job(kind: "backup" | "migrate", extra: Record<string, unknown> = {}) {
  return encodeDataJobInput({
    kind,
    app: APP,
    release: RELEASE,
    activation_seq: "7",
    data_path: "app.sqlite",
    data_schema: kind === "backup" ? 0 : 1,
    ...extra,
  } as never);
}

Deno.test("apps/data#R6, R8: 템플릿 모양 앱의 migrations/0-1.sql이 release의 data_changes와 같은 hash로 data worker에서 0 → 1이 된다", async () => {
  const sql = await template();
  const { root, bundle, data } = await setup(sql);
  try {
    // release.prepare가 낼 data_changes. hash는 파일 byte의 sha256이다.
    const changes = await dataChangesOf({
      root: bundle,
      manifest: {
        entrypoint: "main.ts",
        files: [{ path: "migrations/0-1.sql", hash: await sha256Hex(sql) }],
        sdk_dependencies: [],
      },
    });
    assert(changes.ok);
    assertEquals(changes.value.length, 1);
    assertEquals(changes.value[0].script_hash, await sha256Hex(sql));
    assertEquals([changes.value[0].from, changes.value[0].to], [0, 1]);

    // activation 순서: backup 먼저, 그 뒤 migration.
    const backup = await runDataJobLine(root, job("backup"));
    assert(backup.ok, backup.ok ? "" : backup.error.message);
    const migrated = await runDataJobLine(
      root,
      job("migrate", {
        bundle_path: bundle,
        data_changes: changes.value,
        invocation: INVOCATION,
      }),
    );
    assert(migrated.ok, migrated.ok ? "" : migrated.error.message);
    const output = decodeDataJobOutput(migrated.value);
    assertEquals(output.result.data_schema, 1);
    assertEquals(output.result.invocation, INVOCATION);
    assertEquals(output.result.integrity_ok, true);

    // 앱 DB `app.sqlite`에 템플릿의 표가 생겼고 schema 번호와 단계 hash가 같은 DB에 남는다.
    const db = new DatabaseSync(`${data}/app.sqlite`, { readOnly: true });
    try {
      assertEquals(
        db.prepare(
          "select name from sqlite_master where type = 'table' and name = 'item'",
        ).all().length,
        1,
      );
      const state = db.prepare(
        "select data_schema, last_result, script_hash from lophn_data_schema",
      ).get() as Record<string, unknown>;
      assertEquals(Number(state["data_schema"]), 1);
      assertEquals(state["script_hash"], `sha256:${await sha256Hex(sql)}`);
    } finally {
      db.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps/data#R8: bundle 안 단계 파일이 data_changes의 hash와 다르거나 다른 앱의 bundle이면 migration하지 않는다", async () => {
  const sql = await template();
  const { root, bundle, data } = await setup(sql);
  try {
    const change = {
      from: 0,
      to: 1,
      script_hash: await sha256Hex(sql),
      description: "schema 0 to 1",
    };
    const backup = await runDataJobLine(root, job("backup"));
    assert(backup.ok);
    // 공개한 뒤 파일이 바뀌었다.
    await Deno.writeTextFile(
      `${bundle}/migrations/0-1.sql`,
      `${sql}\n-- edited`,
    );
    const edited = await runDataJobLine(
      root,
      job("migrate", {
        bundle_path: bundle,
        data_changes: [change],
        invocation: INVOCATION,
      }),
    );
    assert(!edited.ok);
    // 이 앱의 bundle 사본이 아닌 경로.
    const foreign = await runDataJobLine(
      root,
      job("migrate", {
        bundle_path:
          `${root}/apps/app_01h455vb4pex5v6nkc6gd5fdw2/bundles/${BUNDLE_HASH}`,
        data_changes: [change],
        invocation: INVOCATION,
      }),
    );
    assert(!foreign.ok);
    const db = new DatabaseSync(`${data}/app.sqlite`, { readOnly: true });
    try {
      assertEquals(
        db.prepare(
          "select name from sqlite_master where type = 'table' and name = 'item'",
        ).all().length,
        0,
      );
    } finally {
      db.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
