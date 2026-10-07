// /v1/apps/export의 실제 core 경로 테스트(apps/data#R13, architecture/apps 5.4).
// 등록은 apps.ts workerRoutes가 하고, serving은 core가 제품 기동에서 직접 붙인다(apps-export.ts).
// 이 테스트는 workers seam 없이 core를 제품 방식으로 띄운다. 앱·release 행은 등록 transaction이
// 남기는 모양으로 심는다(blob_test.ts seedRef와 같은 길이다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import type { Blueprint } from "../../packages/apps/blueprint/mod.ts";
import { canonicalJson } from "../../packages/apps/blueprint/mod.ts";
import { APP } from "../../packages/apps/releases/testing/mod.ts";
import {
  bundleCopyPath,
  sealBundle,
} from "../../packages/apps/releases/mod.ts";
import { installPackage } from "../../packages/apps/sdk/mod.ts";
import { removeTree } from "../../packages/apps/sdk/testing/mod.ts";
import { openAppDatabase } from "../../packages/apps/data/worker/db.ts";
import { startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./apps.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const NOW_MS = Date.UTC(2024, 0, 1);
const AT = "2024-01-01T00:00:00.000Z";
const RELEASE_ID = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const TEST_VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";

const teams: TeamModule[] = [{ createLedgerRegistration }];

type ExportBody = {
  app?: string;
  state?: string;
  reason?: { code?: string; summary?: string };
  includes_external_data?: boolean;
  error?: { code?: string; message?: string };
};

// sync hash. sqlite seed 안에서 쓴다(createHash, node:crypto).
function seedHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function userContext(
  operations: string[],
  ref: string,
  conditions: Record<string, string> = {},
): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations, targets: {} },
    conditions,
    credential_ref: ref,
  } as AuthenticatedContext;
}

async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: ExportBody }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ExportBody };
}

// 앱·release 행을 등록 transaction이 남기는 모양으로 심는다(blob_test.ts seedRef와 같다).
function seedLedger(
  dataRoot: string,
  blueprintJson: string,
  bundleHash: string,
): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'calendar', 'Calendar', 'Keeps one calendar', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, RELEASE_ID);
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
function seedDatabase(databasePath: string): void {
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
  writer.close();
}

// SDK Package와 봉인 bundle 사본을 준비한다. export는 그 사본을 읽는다.
async function seedBundleAndSdk(
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

Deno.test(
  "apps/data#R13: workers seam 없이 띄운 core의 /v1/apps/export는 내 앱을 ready로 답하고 없는 앱과 범위 밖 앱을 같은 not_found로 닫는다",
  async () => {
    const home = await Deno.makeTempDir({ prefix: "lophn-app-export-core-" });
    const started = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules: [new URL("./apps.ts", import.meta.url).href],
      clock: manualClock(NOW_MS),
      random: seededRandom(11),
      testCredentials: true,
      superviseIo: false,
    });
    assert(started.ok, started.ok ? "" : started.error.message);
    await using guard = closeUnlessKept(async () => {
      await started.value.shutdown();
      // 봉인 디렉터리를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    });
    const core = started.value;
    // scope.operations는 route name "app.export"를 넣는다(credential operation scope).
    const owner = userContext(["app.export"], "cred-export");
    const token = "b".repeat(43);
    const scoped = userContext(["app.export"], "cred-scoped", { app: APP });
    const scopedToken = "c".repeat(43);
    for (const [context, secret] of [[owner, token], [scoped, scopedToken]]) {
      const accepted = await core.acceptTestCredential?.(
        context as AuthenticatedContext,
        secret as string,
      );
      assert(accepted?.ok, "test credential seed failed");
      const recorded = await core.record(context as AuthenticatedContext);
      assert(recorded.ok, recorded.ok ? "" : recorded.error?.message ?? "");
    }
    guard.keep();
    try {
      const fixtures = await seedBundleAndSdk(home);
      const dataArea = `${home}/apps/${APP}/data`;
      const databasePath = `${dataArea}/app.sqlite`;
      await Deno.mkdir(dataArea, { recursive: true });
      seedDatabase(databasePath);
      seedLedger(home, fixtures.blueprintJson, fixtures.bundleHash);

      const answer = await post(core.port, "apps/export", { app: APP }, token);
      assertEquals(answer.status, 200, JSON.stringify(answer.body));
      assertEquals(answer.body.app, APP);
      assertEquals(answer.body.state, "ready");
      assertEquals(answer.body.includes_external_data, false);

      // 없는 앱과 범위 밖 앱은 같은 답이다(존재를 새지 않는다). 둘 다 503이 아니다.
      const absent = await post(core.port, "apps/export", {
        app: "app_01h455vb4pex5v6nkc6gd5fdw3",
      }, token);
      assertEquals(absent.status, 404, JSON.stringify(absent.body));
      const other = await post(
        core.port,
        "apps/export",
        { app: OTHER_APP },
        scopedToken,
      );
      assertEquals(other.status, 404, JSON.stringify(other.body));
      assertEquals(other.body.error?.code, absent.body.error?.code);
      assertEquals(other.body.error?.message, absent.body.error?.message);
    } finally {
      await core.shutdown();
      // 봉인 디렉터리(export 안 bundle·SDK 사본)를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    }
  },
);
