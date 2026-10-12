// flow update-lophn 1〜4·8단계: OS 설치 대신 temp 설치 root의 파일만 사람이 바꾼다.
// shell workspace·agent 효과 복구·실제 OS 설치 검증은 이 테스트의 범위가 아니다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom, sha256Hex } from "../../base/mod.ts";
import { appsSchemaSteps } from "../apps/registration/mod.ts";
import { versionsSchemaSteps } from "../projects/versions/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../storage/ledger/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../config/mod.ts";
import { SECRET_SCHEMA_STEPS } from "../secrets/mod.ts";
import { readUpdatePackage } from "./mod.ts";
import { CREDENTIAL_SCHEMA } from "../server/credentials.ts";
import { type Core, startCore } from "../main/daemon/core.ts";
import { assemble } from "../main/daemon/registration.ts";
import { withPlatform } from "../main/daemon/platform-register.ts";

const NOW = Date.UTC(2024, 0, 1);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const teams = [{
  createCoreRegistration: () => ({
    schemaSteps: [...versionsSchemaSteps, ...appsSchemaSteps],
  }),
}];
function steps() {
  const built = withPlatform(assemble(teams));
  assert(built.ok);
  return [
    ...LEDGER_SCHEMA_STEPS,
    CREDENTIAL_SCHEMA,
    ...built.value.schemaSteps,
    ...SETTINGS_SCHEMA_STEPS,
    ...SECRET_SCHEMA_STEPS,
  ];
}
async function boot(
  home: string,
  extra: Partial<Parameters<typeof startCore>[0]> = {},
) {
  return await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [],
    superviseIo: false,
    clock: manualClock(NOW + 1),
    random: seededRandom(5),
    maintenance: () => Promise.resolve(),
    ...extra,
  });
}
async function seed(home: string) {
  // 모든 참조 hash는 실제 저장한 바이트다. 테스트의 원본 문서·앱 SQLite·pinned SDK는 H에 있다.
  const body = new TextEncoder().encode("# 남길 문서\n본문");
  const hash = await sha256Hex(body);
  const blobDir = `${home}/blobs/sha256/${hash.slice(0, 2)}`;
  await Deno.mkdir(blobDir, { recursive: true });
  await Deno.writeFile(`${blobDir}/${hash.slice(2)}`, body);
  await Deno.mkdir(`${home}/apps/${APP}`, { recursive: true, mode: 0o700 });
  const app = new DatabaseSync(`${home}/apps/${APP}/app.db`);
  app.exec(
    "create table todos (body text); insert into todos values ('남길 할 일')",
  );
  app.close();
  await Deno.mkdir(`${home}/sdk/pinned`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/sdk/pinned/mod.ts`,
    "export const pinned = true;\n",
  );
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      "insert into documents (id, title, latest_version, revision, status) values (?, ?, ?, '1', 'active')",
    ).run(DOC, "남길 문서", VER);
    db.prepare(
      "insert into versions (id, document, number, files_hash, primary_path, file_count, content_hash, format_name, module_hash, format_explicit, saved_by, saved_at) values (?, ?, 1, ?, 'a.md', 1, ?, 'document', ?, 0, 'user', ?)",
    ).run(VER, DOC, hash, hash, hash, new Date(NOW).toISOString());
    db.prepare(
      "insert into version_files values (?, 'a.md', ?, ?, 'text/markdown', 1)",
    ).run(VER, hash, body.length);
    db.prepare(
      "insert into apps (id, slug, name, description, active_release, run_enabled, revision, status) values (?, 'todo', '할 일', '남길 앱', 'rel-kept', 0, '1', 'active')",
    ).run(APP);
    db.exec(
      `insert into setting_choices values ('common', 'shell.reading_width', '"wide"')`,
    );
  } finally {
    db.close();
  }
  return { hash, body };
}
async function kept(home: string, expected: Awaited<ReturnType<typeof seed>>) {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    assertEquals(
      db.prepare("select title, latest_version from documents where id = ?")
        .get(DOC),
      { title: "남길 문서", latest_version: VER },
    );
    assertEquals(
      db.prepare("select active_release from apps where id = ?").get(APP)
        ?.active_release,
      "rel-kept",
    );
    assertEquals(
      db.prepare(
        "select value from setting_choices where key = 'shell.reading_width'",
      ).get()?.value,
      '"wide"',
    );
    assertEquals(
      db.prepare("pragma integrity_check").get()?.integrity_check,
      "ok",
    );
  } finally {
    db.close();
  }
  assertEquals(
    await Deno.readFile(
      `${home}/blobs/sha256/${expected.hash.slice(0, 2)}/${
        expected.hash.slice(2)
      }`,
    ),
    expected.body,
  );
  const app = new DatabaseSync(`${home}/apps/${APP}/app.db`, {
    readOnly: true,
  });
  try {
    assertEquals(
      app.prepare("select body from todos").get()?.body,
      "남길 할 일",
    );
  } finally {
    app.close();
  }
  assertEquals(
    await Deno.readTextFile(`${home}/sdk/pinned/mod.ts`),
    "export const pinned = true;\n",
  );
}

Deno.test("platform/install-and-update#R13 #R14 #R15: flow update-lophn은 안내→정상 정지→수동 설치 교체→검증 backup migration→재시작에서 H를 유지한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-update-flow-" });
  const home = `${root}/data`;
  const install = `${root}/install`;
  let core: Core | undefined;
  try {
    await Deno.mkdir(home, { mode: 0o700 });
    await Deno.mkdir(install);
    await Deno.writeTextFile(`${install}/version`, "old");
    const all = steps();
    const prior = await applyMigrations(`${home}/lophn.db`, all, {
      clock: manualClock(NOW),
    });
    assert(prior.ok);
    const expected = await seed(home);
    const opened = await boot(home);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    core = opened.value;
    const candidatePath = `${root}/candidate.json`;
    await Deno.writeTextFile(
      candidatePath,
      JSON.stringify({
        version: "new",
        os: "linux",
        format: "deb",
        schema: all.length + 1,
      }),
    );
    const candidate = await readUpdatePackage(candidatePath);
    assert(candidate.ok);
    const epoch = core.epoch;
    const notice = core.updateNotice("old", candidate.value);
    assert(notice.ok);
    assertEquals([
      notice.value.new_version,
      notice.value.os,
      notice.value.schema,
      notice.value.restart_required,
      notice.value.method,
      notice.value.deployment,
    ], ["new", "linux", "migration_required", true, "manual", "unverified"]);
    assertEquals(await Deno.readTextFile(`${install}/version`), "old");
    assertEquals(core.epoch, epoch); // 안내는 사용 중 재시작하지 않는다.
    await kept(home, expected);
    assert((await core.stopForUpdate()).ok);
    // OS installer가 아니라 temp 설치 root의 파일 교체를 사람이 수행한다.
    await Deno.writeTextFile(`${install}/version`, "new");
    const restarted = await boot(home);
    assert(restarted.ok, restarted.ok ? "" : restarted.error.message);
    core = restarted.value;
    assertEquals(await Deno.readTextFile(`${install}/version`), "new");
    await kept(home, expected);
    // 실제 Deno/SQLite core와 등록된 인증 API. 설치 전체 Electron/MCP/CLI는 미검증이다.
    const response = await fetch(
      `http://127.0.0.1:${core.port}/v1/platform/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assertEquals(response.status, 401);
    await response.body?.cancel();
    assert((await core.stopForUpdate()).ok);
    const failed = await applyMigrations(`${home}/lophn.db`, [...all, {
      id: "broken-update",
      sql:
        "create table should_rollback (n integer); insert into no_such_table values (1)",
    }], { clock: manualClock(NOW + 2), recovery: { root: home } });
    assert(!failed.ok);
    const backups = [];
    for await (const entry of Deno.readDir(`${home}/backups/migrations`)) {
      backups.push(entry.name);
    }
    assertEquals(backups.length, 1);
    const copy = new DatabaseSync(
      `${home}/backups/migrations/${backups[0]}/ledger.db`,
      { readOnly: true },
    );
    try {
      assertEquals(
        copy.prepare("select count(*) n from schema_migrations").get()?.n,
        all.length,
      );
      assertEquals(
        copy.prepare("pragma integrity_check").get()?.integrity_check,
        "ok",
      );
      assertEquals(
        copy.prepare("select title from documents").get()?.title,
        "남길 문서",
      );
    } finally {
      copy.close();
    }
    const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      assertEquals(
        db.prepare("select count(*) n from schema_migrations").get()?.n,
        all.length,
      );
      assertEquals(
        db.prepare(
          "select name from sqlite_master where name = 'should_rollback'",
        ).get(),
        undefined,
      );
    } finally {
      db.close();
    }
    await kept(home, expected);
    const recoveryNotice = core.updateNotice("new", {
      ...candidate.value,
      schema: all.length - 1,
    });
    assert(recoveryNotice.ok);
    assertEquals(recoveryNotice.value.schema, "newer_than_package");
    assertStringIncludes(
      recoveryNotice.value.instructions.join("\n"),
      "호환되는 검증 backup",
    );
    assertStringIncludes(
      recoveryNotice.value.instructions.join("\n"),
      "명시 승인",
    );
    const again = await boot(home);
    assert(again.ok, again.ok ? "" : again.error.message);
    core = again.value;
    await kept(home, expected);
  } finally {
    await core?.shutdown();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R14: 새 core는 schema 변경 전에 검증 복구본을 만들고 이전 자료를 유지한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-update-schema-" });
  let core: Core | undefined;
  try {
    const all = steps();
    assert(
      (await applyMigrations(`${home}/lophn.db`, all.slice(0, -1), {
        clock: manualClock(NOW),
      })).ok,
    );
    const expected = await seed(home);
    const opened = await boot(home);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    core = opened.value;
    await kept(home, expected);
    const backups = [];
    for await (const entry of Deno.readDir(`${home}/backups/migrations`)) {
      backups.push(entry.name);
    }
    assertEquals(backups.length, 1);
    const db = new DatabaseSync(
      `${home}/backups/migrations/${backups[0]}/ledger.db`,
      { readOnly: true },
    );
    try {
      assertEquals(
        db.prepare("select count(*) n from schema_migrations").get()?.n,
        all.length - 1,
      );
      assertEquals(
        db.prepare("pragma integrity_check").get()?.integrity_check,
        "ok",
      );
      assertEquals(
        db.prepare("select title from documents").get()?.title,
        "남길 문서",
      );
    } finally {
      db.close();
    }
  } finally {
    await core?.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R14: 검증 backup을 만들 수 없으면 core는 schema를 바꾸거나 원본을 초기화하지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-update-backup-fail-" });
  try {
    const all = steps();
    assert(
      (await applyMigrations(`${home}/lophn.db`, all.slice(0, -1), {
        clock: manualClock(NOW),
      })).ok,
    );
    const expected = await seed(home);
    await Deno.writeTextFile(`${home}/backups`, "막힌 backup 자리");
    const opened = await boot(home);
    assert(!opened.ok);
    await kept(home, expected);
    const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      assertEquals(
        db.prepare("select count(*) n from schema_migrations").get()?.n,
        all.length - 1,
      );
      assertEquals(
        db.prepare("select name from sqlite_master where name = 'app_secrets'")
          .get(),
        undefined,
      );
    } finally {
      db.close();
    }
    const metadata = await Deno.stat(`${home}/run/location.json`).catch(() =>
      undefined
    );
    assertEquals(metadata, undefined);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R14: 겹친 update 정지는 실제 barrier를 기다리고 정상 정지 실패면 교체로 넘어가지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-update-stop-" });
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const started = await boot(home, {
    failShutdown: async () => {
      entered();
      await waiting;
      throw new Error("stop failed");
    },
  });
  assert(started.ok);
  const core = started.value;
  try {
    const first = core.stopForUpdate();
    await reached;
    let finished = false;
    const second = core.stopForUpdate().then((result) => {
      finished = true;
      return result;
    });
    await Promise.resolve();
    assertEquals(finished, false);
    release();
    assert(!(await first).ok);
    assert(!(await second).ok);
    assert(!(await core.stopForUpdate()).ok);
  } finally {
    release();
    await core.shutdown().catch(() => {});
    await Deno.remove(home, { recursive: true });
  }
});
