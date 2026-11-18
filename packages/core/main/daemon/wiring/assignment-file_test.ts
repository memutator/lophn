import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../../protocol/apps/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { judge } from "../../../approvals/gate/mod.ts";
import { appsSchemaSteps } from "../../../apps/registration/schema.ts";
import { releasesSchemaSteps } from "../../../apps/releases/schema.ts";
import { insertRelease } from "../../../apps/releases/store.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { domainsSchemaSteps } from "./domains-retire.ts";
import {
  assignmentFileStep,
  denyRuleSlugStep,
  readAssignment,
} from "./assignment-file.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const NOTES = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const LEDGER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OTHER = "app_01hzzzzzzzzzzzzzzzzzzzzzzc";
const REVIEWER = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
const GONE = "agt_01hzzzzzzzzzzzzzzzzzzzzzzb";

const command = (name: string) => ({
  name,
  description: name,
  inputSchema: null,
  effect: "write",
  public: true,
});

// 사용자 data를 잃으면 안 된다: 옛 표의 할당을 정의 파일로 옮긴 뒤에도 같은 agent가 같은 앱 command를 보고 judge가 같은 판정을 낸다.
test("data step이 옛 할당을 정의 파일로 옮기면 judge가 같은 판정을 낸다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-assignment-file-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
      db.exec(step.sql);
    }
    db.exec(
      "create table agent_assignments (agent text primary key, entries text, revision integer, updated_at text)",
    );
    const sql = {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    };
    for (const [index, [id, slug]] of [
      [NOTES, "notes"],
      [LEDGER, "ledger"],
      [OTHER, "other"],
    ].entries()) {
      db.prepare(
        "INSERT INTO apps VALUES (?, ?, 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')",
      ).run(id, slug);
      const record = {
        id: `rel_01hzzzzzzzzzzzzzzzzzzzzzz${index}`,
        app: id,
        number: 1,
        code_commit: "0".repeat(40),
        bundle_hash: "0".repeat(64),
        declaration_hash: "0".repeat(64),
        data_schema: 1,
        data_changes: [],
        created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
        created_at: "2026-10-16T00:00:00.000Z",
        status: "prepared",
      } as unknown as ReleaseRecord;
      insertRelease(
        { sql } as unknown as Tx,
        record,
        JSON.stringify({
          commands: [command("session.usage"), command("note.add")],
        }),
        {} as never,
      );
      db.prepare(
        "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
      ).run(record.created_at, record.id);
    }
    const insert = db.prepare(
      "INSERT INTO agent_assignments VALUES (?, ?, 1, 'now')",
    );
    insert.run(
      REVIEWER,
      JSON.stringify([
        { app: NOTES, removed_tools: ["session.usage"] },
        { app: LEDGER, removed_tools: [] },
      ]),
    );
    insert.run(GONE, JSON.stringify([{ app: NOTES, removed_tools: [] }]));
    db.close();
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents", `${REVIEWER}.md`),
      "---\nhandle: reviewer\nname: reviewer\n---\nbody\n",
    );

    const ran = await assignmentFileStep.run(root, stepDeps);
    assert.ok(ran.ok);

    const file = await readFile(join(root, "agents", `${REVIEWER}.md`), "utf8");
    assert.match(file, /apps:\n {2}- notes\n {2}- ledger\n/);
    assert.match(file, /deny:\n {4}- lophn\(notes session usage\)\n/);

    const opened = openConnection(join(root, "lophn.db"));
    assert.ok(opened.ok);
    try {
      const table = opened.value.sql.get(
        "select 1 as found from sqlite_master where name = 'agent_assignments'",
        [],
      );
      assert.equal(table, undefined);
      const read = readAssignment(opened.value.sql, REVIEWER as never);
      assert.ok(read.ok);
      const { assignment } = read.value;
      assert.deepStrictEqual(assignment.entries, [
        { app: NOTES, removed_tools: ["session.usage"] },
        { app: LEDGER, removed_tools: [] },
      ]);
      const call = (app: string, tool: string) =>
        judge(
          { kind: "app_tool", app, tool, effect: "write" } as never,
          assignment,
          { floor: [], layers: [] },
          "attended",
          false,
        );
      assert.deepStrictEqual(call(NOTES, "note.add"), { kind: "run" });
      assert.deepStrictEqual(call(LEDGER, "session.usage"), { kind: "run" });
      assert.deepStrictEqual(call(NOTES, "session.usage"), {
        kind: "deny",
        reason: "removed",
        pattern: null,
      });
      assert.deepStrictEqual(call(OTHER, "note.add"), {
        kind: "deny",
        reason: "not_assigned",
        pattern: null,
      });
    } finally {
      opened.value.close();
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

// 권한 경계: 앱의 둘째 domain 이름으로 막아 둔 command가 domain 폐지 뒤에도 같은 판정(removed)으로 막혀야 한다.
test("deny step은 앱 둘째 domain의 규칙을 앱 slug 규칙으로 바꾸고 그 command는 여전히 막힌다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-deny-slug-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    for (const step of [
      ...appsSchemaSteps,
      ...releasesSchemaSteps,
      ...domainsSchemaSteps,
    ]) {
      db.exec(step.sql);
    }
    const sql = {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
    };
    db.prepare(
      "INSERT INTO apps VALUES (?, 'notes', 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')",
    ).run(NOTES);
    // 앱 이름의 domain(notes)과 둘째 domain(journal). 앱 밖 project의 domain(side)은 앱 규칙이 아니다.
    for (const [id, name, kind, owner] of [
      ["dom_1", "notes", "app", NOTES],
      ["dom_2", "journal", "app", NOTES],
      ["dom_3", "side", "project", "prj_1"],
    ]) {
      db.prepare(
        "INSERT INTO domains VALUES (?, ?, 't', 'p', ?, ?, '1', 'active')",
      ).run(id, name, kind, owner);
    }
    insertRelease(
      { sql } as unknown as Tx,
      {
        id: "rel_01hzzzzzzzzzzzzzzzzzzzzzz0",
        app: NOTES,
        number: 1,
        code_commit: "0".repeat(40),
        bundle_hash: "0".repeat(64),
        declaration_hash: "0".repeat(64),
        data_schema: 1,
        data_changes: [],
        created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
        created_at: "2026-10-16T00:00:00.000Z",
        status: "prepared",
      } as unknown as ReleaseRecord,
      JSON.stringify({ commands: [command("entry.add"), command("note.add")] }),
      {} as never,
    );
    db.prepare(
      "UPDATE releases SET status = 'active', activated_at = '2026-10-16T00:00:00.000Z' WHERE id = 'rel_01hzzzzzzzzzzzzzzzzzzzzzz0'",
    ).run();
    db.close();
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents", `${REVIEWER}.md`),
      `---\nhandle: reviewer\nname: reviewer\napps:\n  - notes\npermissions:\n  deny:\n    - lophn(journal entry add)\n    - lophn(side entry add)\n    - Bash(rm *)\n---\nbody\n`,
    );

    // 바꾸기 전에는 domain 이름 규칙이 앱 slug 규칙과 맞지 않아 command가 열려 있다.
    const before = openConnection(join(root, "lophn.db"));
    assert.ok(before.ok);
    try {
      const read = readAssignment(before.value.sql, REVIEWER as never);
      assert.ok(read.ok);
      assert.deepStrictEqual(read.value.assignment.entries, [
        { app: NOTES, removed_tools: [] },
      ]);
    } finally {
      before.value.close();
    }

    for (let run = 0; run < 2; run += 1) {
      const ran = await denyRuleSlugStep.run(root, stepDeps);
      assert.ok(ran.ok);
    }

    const file = await readFile(join(root, "agents", `${REVIEWER}.md`), "utf8");
    assert.match(file, /- lophn\(notes entry add\)\n/);
    assert.match(file, /- lophn\(side entry add\)\n/);
    assert.match(file, /- Bash\(rm \*\)\n/);
    assert.match(file, /\n---\nbody\n$/);

    const opened = openConnection(join(root, "lophn.db"));
    assert.ok(opened.ok);
    try {
      const read = readAssignment(opened.value.sql, REVIEWER as never);
      assert.ok(read.ok, JSON.stringify(read));
      assert.deepStrictEqual(read.value.assignment.entries, [
        { app: NOTES, removed_tools: ["entry.add"] },
      ]);
      const call = (tool: string) =>
        judge(
          { kind: "app_tool", app: NOTES, tool, effect: "write" } as never,
          read.value.assignment,
          { floor: [], layers: [] },
          "attended",
          false,
        );
      assert.deepStrictEqual(call("entry.add"), {
        kind: "deny",
        reason: "removed",
        pattern: null,
      });
      assert.deepStrictEqual(call("note.add"), { kind: "run" });
    } finally {
      opened.value.close();
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
