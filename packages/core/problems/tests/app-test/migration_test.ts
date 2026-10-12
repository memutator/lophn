// change-app 5단계의 migration 2종 app test(docs/flows/change-app.md 5). 빈 DB 전체
// migration과 이전 release schema → 새 schema migration을 apps/data의 실제 data worker job으로
// 돌리고, 외부 효과는 apps/preview의 고정 대역에만 보낸다. problems 쪽 harness와 판정이
// 그 결과로 pass·fail을 정한다(problems/tests#R8, R9, R15).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../../base/mod.ts";
import {
  type DataChange,
  decodeDataJobOutput,
  encodeDataJobInput,
} from "../../../../protocol/apps/mod.ts";
import type { TestObservationFrame } from "../../../../protocol/problems/mod.ts";
import { createAppBackup } from "../../../apps/data/worker/backup.ts";
import { openAppDatabase } from "../../../apps/data/worker/db.ts";
import { runDataJob } from "../../../apps/data/worker/job.ts";
import {
  migrateAppDatabase,
  type MigrationScript,
} from "../../../apps/data/worker/migrate.ts";
import {
  createPreviewBrokerServices,
  previewScopeOf,
} from "../../../apps/preview/mod.ts";
import {
  type AppTestInput,
  generateAppTestChecks,
  judgeAppTest,
  sdkDependenciesHash,
} from "./mod.ts";
import {
  type AdapterEffects,
  type AppDriver,
  createEmitter,
  type MigrationRun,
  type MigrationScenario,
  observeFailurePath,
  runPlatformChecks,
} from "../harness/mod.ts";
import { fixtureDriver } from "../testing/app-driver.ts";
import { acceptFrame, emptySides } from "../work/ipc.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const TEST_HASH = "c".repeat(64);
const BUNDLE = "d".repeat(64);
const HASH = "a".repeat(64);
const SDK = [{ name: "@lophn/cap-problem", version: "1.0.0" }];
const NONCE = "nonce-test-1";
const TARGET = 2;
const PREVIOUS = 1;

async function script(
  from: number,
  to: number,
  sql: string,
): Promise<MigrationScript> {
  const change: DataChange = {
    from,
    to,
    script_hash: `sha256:${await sha256Hex(sql)}`,
    description: `schema ${from} to ${to}`,
  };
  return { change, sql };
}

// 두 번째 단계는 이전 schema에 같은 값의 행이 둘 이상 있으면 실패한다. 빈 DB에서는 통과한다.
async function bundleScripts(options: { breaksOnData: boolean }) {
  return [
    await script(
      0,
      1,
      "create table items (id integer primary key, body text not null)",
    ),
    await script(
      1,
      2,
      options.breaksOnData
        ? "alter table items add column slug text not null default ''; create unique index items_slug on items(slug)"
        : "alter table items add column slug text not null default ''",
    ),
  ];
}

async function realMigrate(
  scenario: MigrationScenario,
  scripts: readonly MigrationScript[],
): Promise<MigrationRun> {
  const area = await Deno.makeTempDir({ prefix: "lophn-app-contract-" });
  try {
    const databasePath = `${area}/data.db`;
    const opened = openAppDatabase(databasePath);
    assert(opened.ok);
    opened.value.close();
    const result = { release: RELEASE, activation_seq: "1", invocation: null };
    const appliedAt = "2026-01-01T00:00:00.000Z";
    if (scenario === "upgrade") {
      // 이전 release의 schema까지 만든 fixture DB에 업무 행을 넣는다.
      const seedBackup = await createAppBackup(area, databasePath, "seed");
      assert(seedBackup.ok);
      const previous = await migrateAppDatabase({
        dataArea: area,
        databasePath,
        backupPath: `${area}/backups/seed`,
        targetSchema: PREVIOUS,
        scripts,
        appliedAt,
        result,
      });
      assert(previous.ok && !previous.value.restored);
      const db = new DatabaseSync(databasePath);
      db.exec("insert into items (body) values ('a'), ('b')");
      db.close();
    }
    const before = openAppDatabase(databasePath);
    assert(before.ok);
    const from = before.value.schemaState().dataSchema;
    before.value.close();
    const backup = await createAppBackup(area, databasePath, "backup-1");
    assert(backup.ok);
    const job = await runDataJob(
      { dataArea: area, databasePath, scripts, appliedAt, invocation: null },
      encodeDataJobInput({
        kind: "migrate",
        app: APP,
        release: RELEASE,
        activation_seq: "1",
        data_path: "data.db",
        data_schema: TARGET,
      }),
    );
    if (!job.ok) {
      return {
        ok: false,
        from_schema: from,
        data_schema: from,
        integrity_ok: false,
        restored: false,
        reason: job.error.message,
      };
    }
    const done = decodeDataJobOutput(job.value).result;
    return {
      ok: true,
      from_schema: from,
      data_schema: done.data_schema,
      integrity_ok: done.integrity_ok,
      // 중간 단계 실패는 첫 변경 전 backup으로 되돌아가 목표 schema에 닿지 못한다.
      restored: done.data_schema !== TARGET,
      reason: done.data_schema === TARGET ? "migrated" : "restored",
    };
  } finally {
    await Deno.remove(area, { recursive: true });
  }
}

function inputFor(): AppTestInput {
  const command = (
    key: string,
    effect: string,
    revert: unknown = { supported: false },
  ) => ({ key, effect, confirm: false, revert });
  const blueprint = {
    problem_codes: [{
      code: "save_failed",
      message_key: "app-detail.issue.save_failed",
      message: "Saving failed.",
      fixer: "coding_agent",
    }],
    commands: [
      command("list", "read"),
      command("add", "write", { supported: true, command: "undo" }),
      command("undo", "write"),
      command("push", "external"),
    ],
    screens: [],
    sdk_dependencies: SDK,
    automatic_tasks: [],
    permissions: [
      { kind: "secret.use", scope: { name: "calendar_token" }, reason: "x" },
      {
        kind: "net.fetch",
        scope: { host: "api.example.com", port: 443 },
        reason: "x",
      },
      { kind: "document.save", scope: { key: "notes" }, reason: "x" },
    ],
    app_connections: [],
  } as unknown as AppTestInput["blueprint"];
  return {
    bundle_hash: BUNDLE,
    test_hash: TEST_HASH,
    blueprint,
    blueprint_hash: HASH,
    frozen: {
      blueprint: HASH,
      sdk_dependencies: sdkDependenciesHash(SDK),
      failure_paths: [{ code: "save_failed", test_hash: HASH }],
    },
    fixed_sdk: SDK,
    previous_declarations: null,
    data: { schema: TARGET, previous_schema: PREVIOUS },
  };
}

const SOURCE = [{
  path: "app.ts",
  text:
    `import { reportProblem } from "@lophn/cap-problem";\nreportProblem("save_failed");`,
}];

// 실제 net을 막은 채 고정 대역만 부른다. 대역 밖으로 나가려는 fetch는 기록하고 거절한다.
async function exerciseDoubles(input: AppTestInput) {
  const doubles = createPreviewBrokerServices({
    scope: previewScopeOf(input.blueprint),
  });
  const child = {
    app: APP,
    release: null,
    mode: "test" as const,
    processNonce: NONCE,
  };
  const common = { process_nonce: NONCE, mode: "test", invocation: null };
  const escaped: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (request: Request | URL | string) => {
    escaped.push(String(request));
    return Promise.reject(new Error("real network is not available"));
  };
  try {
    const sent = await doubles.external.request(child, {
      ...common,
      command: "push",
      host: "api.example.com",
      port: 443,
      method: "post",
      path: "/events",
    });
    assert(sent.ok);
    const used = await doubles.secrets.use(child, {
      ...common,
      release: RELEASE,
      command: "push",
      input_hash: HASH,
      name: "calendar_token",
      destination: { scheme: "https", host: "api.example.com", port: 443 },
    });
    assert(used.ok);
    const saved = await doubles.documents.save(child, {
      process_nonce: NONCE,
      mode: "test",
      key: "notes",
      base_version: null,
      idempotency_key: "k1",
    });
    assert(saved.ok);
    // 선언하지 않은 host는 대역이 거절하고 실제로 나가지 않는다.
    const elsewhere = await doubles.external.request(child, {
      ...common,
      command: "push",
      host: "evil.example.net",
      port: 443,
      method: "get",
      path: "/",
    });
    assert(!elsewhere.ok);
  } finally {
    globalThis.fetch = realFetch;
  }
  const effects: AdapterEffects = {
    net: doubles.external.requests.map(({ host, port }) => ({ host, port })),
    secret_uses: doubles.secrets.uses.map(({ name }) => ({ name })),
    document_writes: [...doubles.documents.versions.keys()].map((key) => ({
      key,
    })),
    real_connections: escaped,
  };
  return { effects, doubles };
}

async function appTest(scripts: readonly MigrationScript[]) {
  const input = inputFor();
  const plan = generateAppTestChecks(input);
  const base = fixtureDriver({
    bundle_hash: BUNDLE,
    commands: plan.harness.commands,
    declared_codes: plan.harness.declared_codes,
    failure_commands: { add: "save_failed" },
    has_view: false,
    plan: plan.harness,
  });
  let doubles: Awaited<ReturnType<typeof exerciseDoubles>>["doubles"];
  const driver: AppDriver = {
    ...base,
    migrate: (scenario) => realMigrate(scenario, scripts),
    async exerciseAdapters() {
      const exercised = await exerciseDoubles(input);
      doubles = exercised.doubles;
      return exercised.effects;
    },
  };
  const bytes: Uint8Array[] = [];
  const emitter = createEmitter({
    side: "single",
    test_hash: TEST_HASH,
    write: (frame) => bytes.push(frame),
  });
  const ran = await runPlatformChecks({
    driver,
    plan: plan.harness,
    emitter,
    sources: SOURCE,
  });
  assert(ran.ok);
  await observeFailurePath({
    driver,
    plan: plan.harness,
    emitter,
    code: "save_failed",
    command: "add",
    command_input: {},
  });
  const sides = emptySides();
  for (const frame of bytes) assert(acceptFrame(sides, frame).ok);
  const frames: TestObservationFrame[] = sides.single.frames;
  return {
    judgment: judgeAppTest({ plan, test_hash: TEST_HASH, frames }),
    doubles: doubles!,
  };
}

Deno.test("problems/tests#R8 R9 R15: 두 migration이 실제 data worker job으로 통과하면 app test는 pass이고 외부 효과는 고정 대역에만 닿는다", async () => {
  const { judgment, doubles } = await appTest(
    await bundleScripts({ breaksOnData: false }),
  );
  assertEquals(
    judgment.observations.checks.filter((c) => c.status === "fail"),
    [],
  );
  assertEquals(judgment.result, "pass");
  const checks = judgment.observations.checks;
  for (const name of ["migration_empty", "migration_upgrade"]) {
    assertEquals(checks.find((item) => item.name === name)?.status, "pass");
  }
  assertEquals(
    checks.find((item) => item.name === "adapter_isolation")?.status,
    "pass",
  );
  assertEquals(doubles.external.requests.map((item) => item.host), [
    "api.example.com",
  ]);
  assertEquals(doubles.secrets.uses.map((item) => item.name), [
    "calendar_token",
  ]);
  assertEquals([...doubles.documents.versions.keys()], ["notes"]);
});

Deno.test("problems/tests#R8: 이전 release schema의 데이터에서만 실패하는 migration은 빈 DB 검사가 통과해도 app test가 fail이다", async () => {
  const { judgment } = await appTest(
    await bundleScripts({ breaksOnData: true }),
  );
  assertEquals(judgment.result, "fail");
  const status = (name: string) =>
    judgment.observations.checks.find((item) => item.name === name)?.status;
  assertEquals(status("migration_empty"), "pass");
  assertEquals(status("migration_upgrade"), "fail");
});
