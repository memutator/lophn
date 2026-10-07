// /v1/apps/export의 실제 core 경로 테스트(apps/data#R13, architecture/apps 5.4).
// 등록은 apps.ts workerRoutes가 하고, serving은 core의 workers seam(core.ts T8·T13 통합)에
// createExportTarget을 넣어 연결한다. 앱·release 행은 등록 transaction이 남기는 모양으로
// 심는다(blob_test.ts seedRef와 같은 길이다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  err,
  manualClock,
  ok,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { TargetAuthorization } from "../../packages/contracts/platform/mod.ts";
import { createTargetAuthorizer } from "../../packages/platform/ledger/mod.ts";
import type { Blueprint } from "../../packages/apps/blueprint/mod.ts";
import { canonicalJson } from "../../packages/apps/blueprint/mod.ts";
import { APP } from "../../packages/apps/releases/testing/mod.ts";
import {
  bundleCopyPath,
  sealBundle,
} from "../../packages/apps/releases/mod.ts";
import { installPackage } from "../../packages/apps/sdk/mod.ts";
import { removeTree } from "../../packages/apps/sdk/testing/mod.ts";
import { createExportTarget } from "../../packages/apps/data/reads.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
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
): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: ref,
  } as AuthenticatedContext;
}

// export worker가 요청의 credential_ref로 푼 현재 context를 slot에서 읽는다.
const slot: {
  context?: AuthenticatedContext;
  ledger?: DatabaseSync;
} = {};

// ledger read snapshot(documents-search_test.ts와 같다). ledger 연결은 core 기동 뒤
// 채우는 slot으로늦게 묶는다(startCore 때 lophn.db가 아직 없다). TargetAuthorization
// port는 slot에 채운 현재 context로 만든다.
function ledgerSnapshot() {
  return {
    snapshot: () =>
      ok({
        as_of_seq: "0",
        sql: {
          get: (query: string, params: readonly unknown[]) =>
            slot.ledger === undefined
              ? undefined
              : slot.ledger.prepare(query).get(...params as never[]) as
                | Record<string, unknown>
                | undefined,
          all: (query: string, params: readonly unknown[]) =>
            slot.ledger === undefined
              ? []
              : slot.ledger.prepare(query).all(...params as never[]) as Record<
                string,
                unknown
              >[],
        },
        port<T>(key: unknown): T {
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered port");
          }
          assert(slot.context !== undefined, "context slot is not filled");
          return createTargetAuthorizer(slot.context) as unknown as T;
        },
      } as never),
  };
}

// export target deps. current는 credential_ref로 context를 푼다.
function exportDeps(dataRoot: string) {
  const contexts = new Map<string, AuthenticatedContext>();
  const snapshot = ledgerSnapshot();
  return {
    deps: {
      current: (ref: string): Result<RequestContext> => {
        const found = contexts.get(ref);
        return found === undefined
          ? err({ code: "unauthorized", message: "credential이 없다" })
          : ok(found as unknown as RequestContext);
      },
      snapshot: snapshot.snapshot,
      dataRoot,
      observedAt: () => AT,
    },
    contexts,
    fillLedger(db: DatabaseSync): void {
      slot.ledger = db;
    },
    loadLedger(): DatabaseSync {
      // readOnly 연결. 열림은 테스트 끝에 닫는다.
      return new DatabaseSync(`${dataRoot}/lophn.db`, { readOnly: true });
    },
    close(): void {
      if (slot.ledger !== undefined) {
        slot.ledger.close();
        slot.ledger = undefined;
      }
    },
  };
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
  "apps/data#R13: /v1/apps/export는 등록된 route로 앱 export를 준비하고 범위 밖 앱과 없는 앱을 같이 거절한다",
  async () => {
    const home = await Deno.makeTempDir({ prefix: "lophn-app-export-core-" });
    const made = exportDeps(home);
    const started = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules: [new URL("./apps.ts", import.meta.url).href],
      clock: manualClock(NOW_MS),
      random: seededRandom(11),
      testCredentials: true,
      superviseIo: false,
      // export serving(T8·T13 통합 seam). 제품 기동에는 workers map이 없다.
      workers: new Map<string, WorkerRouteTarget>([
        [
          "apps/export",
          createExportTarget(made.deps) as unknown as WorkerRouteTarget,
        ],
      ]),
    });
    assert(started.ok, started.ok ? "" : started.error.message);
    await using guard = closeUnlessKept(async () => {
      await started.value.shutdown();
      // 봉인 디렉터리를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    });
    const core = started.value;
    // scope.operations는 route name "app.export"를 넣는다(credential operation scope).
    const contextValue = userContext(["app.export"], "cred-export");
    const token = "b".repeat(43);
    const accepted = await core.acceptTestCredential?.(contextValue, token);
    assert(accepted?.ok, "test credential seed failed");
    const recorded = await core.record(contextValue);
    assert(recorded.ok, recorded.ok ? "" : recorded.error?.message ?? "");
    guard.keep();
    made.contexts.set("cred-export", contextValue);
    slot.context = contextValue;
    made.fillLedger(made.loadLedger());
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

      // 범위 밖 앱과 없는 앱은 같은 답이다(존재를 새지 않는다). 존재하지 않는 앱 ID다.
      const absent = await post(core.port, "apps/export", {
        app: "app_01h455vb4pex5v6nkc6gd5fdw3",
      }, token);
      assertEquals(absent.status, 404, JSON.stringify(absent.body));
      const other = await post(
        core.port,
        "apps/export",
        { app: OTHER_APP },
        token,
      );
      assertEquals(other.status, 404);
      assertEquals(other.body.error?.code, absent.body.error?.code);
      assertEquals(other.body.error?.message, absent.body.error?.message);
    } finally {
      made.close();
      await core.shutdown();
      // 봉인 디렉터리(export 안 bundle·SDK 사본)를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    }
  },
);
