import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import { applyMigrations } from "../../../storage/migration/mod.ts";
import { TEAMS, WIRINGS } from "../assembly.ts";
import { assemble } from "../registration.ts";
import { sharedAppsSettingDropStep } from "./share-requests-retired.ts";

function registeredSteps() {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  return [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
}

// 옛 root에는 `share_requests` 표와 열린 요청이 있다. 새 step을 돌리면 표가 사라지고 나머지 data는 그대로다.
test("옛 root의 share_requests 표는 drop step이 거두고 다른 표는 건드리지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-share-drop-"));
  try {
    const steps = registeredSteps();
    const drop = steps.findIndex(
      (step) => step.id === "approvals.share_requests.drop",
    );
    assert.equal(drop, steps.length - 1);
    const ledger = join(root, "lophn.db");
    const deps = { clock: manualClock(0) };
    const before = await applyMigrations(ledger, steps.slice(0, drop), deps);
    assert.ok(before.ok);
    const old = new DatabaseSync(ledger);
    old
      .prepare(
        `insert into share_requests (app, agents, coding_agents, reason, session, requested_at)
         values ('app_1', '[]', 1, 'r', 'ses_1', 'x')`,
      )
      .run();
    old.close();
    const after = await applyMigrations(ledger, steps, deps);
    assert.ok(after.ok);
    const db = new DatabaseSync(ledger);
    const tables = db
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => String(row.name));
    db.close();
    assert.ok(!tables.includes("share_requests"));
    assert.ok(tables.includes("projects"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("data step은 settings.json에서 coding-agent.shared_apps만 지우고 값을 옮기지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-shared-apps-drop-"));
  const stepDeps = {
    ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
  };
  try {
    const file = join(root, "settings.json");
    await writeFile(
      file,
      JSON.stringify({
        other: 1,
        "coding-agent.shared_apps": ["notes"],
      }),
      { mode: 0o600 },
    );
    assert.ok((await sharedAppsSettingDropStep.run(root, stepDeps)).ok);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { other: 1 });
    // 파일이 없거나 이미 지운 root에서도 돈다.
    assert.ok((await sharedAppsSettingDropStep.run(root, stepDeps)).ok);
    await rm(file);
    assert.ok((await sharedAppsSettingDropStep.run(root, stepDeps)).ok);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
