// 앱 export 시험이 함께 쓰는 fixture(apps/data#R13). 앱·release 행은 등록 transaction이 남기는
// 모양으로 ledger에 심고(blob_test.ts seedRef와 같은 길이다), 운영 앱 DB·봉인 bundle 사본·설치
// SDK 사본은 데이터 root 안에 만든다. core route 시험과 e2e flow가 같은 모양을 쓴다.
import { assert } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { sha256Hex } from "../../../packages/base/mod.ts";
import type { Blueprint } from "../../../packages/core/apps/blueprint/mod.ts";
import { canonicalJson } from "../../../packages/core/apps/blueprint/mod.ts";
import {
  bundleCopyPath,
  sealBundle,
} from "../../../packages/core/apps/releases/mod.ts";
import { installPackage } from "../../../packages/core/apps/packages/mod.ts";
import { openAppDatabase } from "../../../packages/core/apps/data/worker/db.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const AT = "2024-01-01T00:00:00.000Z";
export const RELEASE_ID = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const TEST_VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
export const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";

// sync hash. sqlite seed 안에서 쓴다(createHash, node:crypto).
export function seedHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// 앱·release 행을 등록 transaction이 남기는 모양으로 심는다(blob_test.ts seedRef와 같다).
export function seedLedger(
  dataRoot: string,
  blueprintJson: string,
  bundleHash: string,
  // 앱 감독이 돌고 있는 core 옆에서는 0으로 심어 감독이 앱을 띄우지 않게 한다.
  runEnabled = 1,
): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'calendar', 'Calendar', 'Keeps one calendar', NULL, NULL, ?, ?, '1', 'active')`,
    ).run(APP, RELEASE_ID, runEnabled);
    const blueprintHash = seedHash(blueprintJson);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, 0, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      RELEASE_ID,
      APP,
      "a".repeat(40),
      bundleHash,
      blueprintHash,
      AT,
      blueprintJson,
      JSON.stringify({
        release: RELEASE_ID,
        permissions: [],
        app_connections: [],
        commands: [],
        automations: [],
      }),
    );
    // 다른 앱. credential이 APP 조건에 묶이면 이 앱은 범위 밖이다.
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'other', 'Other', 'Another app', NULL, NULL, NULL, 1, '1', 'active')`,
    ).run(OTHER_APP);
    // release row는 유효한 app test 참조를 요구한다(releases#R5). 같은 표 row를 채운다.
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(RELEASE_ID, TEST_VRF);
  } finally {
    db.close();
  }
}

// 운영 앱 DB. WAL에만 있는 항목을 checkpoint 없이 확정한다(data_test.ts와 같다).
export function seedDatabase(databasePath: string): DatabaseSync {
  const opened = openAppDatabase(databasePath);
  assert(opened.ok);
  opened.value.close();
  const writer = new DatabaseSync(databasePath);
  writer.exec("pragma journal_mode = wal");
  writer.exec("create table items (body text not null)");
  writer.prepare("insert into items (body) values (?)").run("committed");
  writer.exec("begin immediate");
  writer.prepare("insert into items (body) values (?)").run("in wal");
  writer.exec("commit");
  // 연결을 열어 둔 채 돌려준다. 열려 있는 동안 WAL은 checkpoint되지 않는다. 호출자가 닫는다.
  return writer;
}

// SDK Package와 봉인 bundle 사본을 준비한다. export는 그 사본을 읽는다.
export async function seedBundleAndSdk(
  home: string,
): Promise<
  {
    blueprintJson: string;
    bundleHash: string;
    sdk: { name: string; version: string }[];
  }
> {
  const sdk = [{ name: "@lophn/sample", version: "1.0.0" }];
  const blueprint: Blueprint = {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full"] }],
    commands: [{
      key: "list",
      label: "list",
      description: "list purpose",
      effect: "read",
      confirm: false,
      input: null,
      revert: { supported: false },
    }],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [...sdk],
  };
  const blueprintJson = canonicalJson(blueprint as never);
  const blueprintHash = await sha256Hex(blueprintJson);
  const mainSource = "export const one = 1;\n";
  // 잠긴 앱 import map(prepare flow의 lockedImports와 같은 규칙). SDK 사본은 bundle 안
  // `./sdk/<이름>/<version>/`의 상대 경로로 가리킨다.
  const lockedImports = {
    imports: { "@lophn/sample/my-sdk": "./sdk/sample/1.0.0/mod.ts" },
  };
  const importMapJson = JSON.stringify(lockedImports);
  const manifest = {
    entrypoint: "main.ts",
    files: [
      { path: "blueprint.json", hash: blueprintHash },
      { path: "main.ts", hash: await sha256Hex(mainSource) },
      { path: "import-map.json", hash: await sha256Hex(importMapJson) },
      {
        path: "sdk/sample/1.0.0/mod.ts",
        hash: "d".repeat(64),
      },
    ],
    sdk_dependencies: [...sdk],
  };
  const bundleHash = await sha256Hex(JSON.stringify(manifest));
  const copy = bundleCopyPath(home, APP, bundleHash);
  assert(copy.ok);
  const sealed = await sealBundle({
    copyPath: copy.value,
    manifest,
    blueprintJson: new TextEncoder().encode(blueprintJson),
    bundleFiles: [
      {
        path: "import-map.json",
        bytes: new TextEncoder().encode(importMapJson),
      },
      { path: "main.ts", bytes: new TextEncoder().encode(mainSource) },
    ],
  });
  assert(sealed.ok, sealed.ok ? "" : sealed.error.message);

  // SDK 설치 소스를 temp에 만든다.
  const installHome = `${home}/.sdk-install-source`;
  await Deno.mkdir(`${installHome}/sample`, { recursive: true });
  await Deno.writeTextFile(
    `${installHome}/sample/mod.ts`,
    "export const x = 1;\n",
  );
  const installed = await installPackage(
    "@lophn/sample",
    "sample package",
    "component",
    "1.0.0",
    new TextEncoder().encode("# sample\n"),
    { dataRoot: home, sourceRoot: installHome },
  );
  assert(installed.ok, installed.ok ? "" : installed.error.message);
  return { blueprintJson, bundleHash, sdk };
}
