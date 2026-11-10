import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { instructionsGet } from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import { projectsSchemaSteps } from "../../projects/registry/schema.ts";
import { createReaderRegistration } from "../../main/daemon/wiring/instructions-registration.ts";
import { conversationTestSteps } from "../session/test-steps.ts";

const PRJ_A = "prj_00000000000000000000000001";
const PRJ_B = "prj_00000000000000000000000002";
const PRJ_C = "prj_00000000000000000000000003";
const APP = "app_00000000000000000000000001";

function sessionId(n: number) {
  return `ses_${String(n).padStart(26, "0")}`;
}

// 임시 폴더에 project 폴더 둘, 실제 schema의 ledger 파일을 만든다.
function setup() {
  const root = mkdtempSync(join(tmpdir(), "lophn-instructions-"));
  const folderA = join(root, "a");
  const folderB = join(root, "b");
  mkdirSync(folderA);
  mkdirSync(folderB);
  writeFileSync(join(folderA, "LOPHN.md"), "rules of A");
  // LOPHN.md가 있으면 CLAUDE.md는 읽지 않는다.
  writeFileSync(join(folderA, "CLAUDE.md"), "claude of A");
  writeFileSync(join(folderB, "LOPHN.md"), "rules of B");
  mkdirSync(join(root, "projects", PRJ_C), { recursive: true });
  writeFileSync(join(root, "projects", PRJ_C, "CLAUDE.md"), "rules of C");
  const db = new DatabaseSync(join(root, "ledger.db"));
  for (const step of [...projectsSchemaSteps, ...conversationTestSteps]) {
    db.exec(step.sql);
  }
  for (const [id, name, folder] of [
    [PRJ_A, "a", folderA],
    [PRJ_B, "b", folderB],
  ]) {
    db.prepare("insert into projects values (?, ?, ?, '', '1', 'active')").run(
      id,
      name,
      name,
    );
    db.prepare("insert into project_folders values (?, 0, ?, '')").run(
      id,
      folder,
    );
  }
  // project C는 등록 폴더가 없다. 지침은 <data>/projects/<prj>/에 있고 LOPHN.md 없이 CLAUDE.md뿐이다.
  db.prepare(
    "insert into projects values (?, 'c', 'c', '', '1', 'active')",
  ).run(PRJ_C);
  const insert = db.prepare(
    `insert into sessions (id, agent, project, app, workspace_kind, workspace_id,
       created_seq, state_seq) values (?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  insert.run(sessionId(1), "lophn", null, null, null, null);
  insert.run(sessionId(2), "agt_1", PRJ_A, null, "project", PRJ_A);
  insert.run(sessionId(4), "agt_2", PRJ_C, null, "project", PRJ_C);
  insert.run(sessionId(3), "agt_3", null, APP, "app", APP);
  const snapshot = {
    as_of_seq: 1n,
    sql: {
      get: (query: string, params: never[]) => db.prepare(query).get(...params),
      all: (query: string, params: never[]) => db.prepare(query).all(...params),
    },
  } as unknown as ReadSnapshot;
  return { root, snapshot, db };
}

function read(snapshot: ReadSnapshot, session: number) {
  const handler = createReaderRegistration().reads[0] as ReadDefinition<
    typeof instructionsGet
  >;
  const result = handler.handle(
    snapshot,
    {} as never,
    { session: sessionId(session), layer: "project" } as never,
  );
  if (!result.ok) return result.error.code;
  const file = result.value.file;
  return file === null ? null : `${file.name}:${atob(file.content_base64)}`;
}

test("project 층은 session의 workspace가 가리키는 project의 LOPHN.md(없으면 CLAUDE.md)만 읽는다", () => {
  const { root, snapshot, db } = setup();
  try {
    const table: [number, string | null][] = [
      // [session, 결과]
      [1, null], // home session은 workspace가 없어 project 지침이 비어 있다
      [2, "LOPHN.md:rules of A"],
      [3, null], // 앱 그릇에는 LOPHN.md가 없다
      [4, "CLAUDE.md:rules of C"], // 폴더 없는 project는 data 자리의 파일이고 LOPHN.md가 없으면 CLAUDE.md다
    ];
    for (const [session, expected] of table) {
      assert.deepStrictEqual(read(snapshot, session), expected, `${session}`);
    }
  } finally {
    // 열린 DB file은 Windows에서 지워지지 않는다.
    db.close();
    rmSync(root, { recursive: true });
  }
});
