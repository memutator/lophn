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
import { domainsSchemaSteps } from "../../domains/schema.ts";
import { projectsSchemaSteps } from "../../projects/registry/schema.ts";
import { conversationSchemaSteps } from "../session/model.ts";
import { createReaderRegistration } from "../../main/daemon/wiring/instructions-registration.ts";

const PRJ_A = "prj_00000000000000000000000001";
const PRJ_B = "prj_00000000000000000000000002";
const PRJ_C = "prj_00000000000000000000000003";
const APP = "app_00000000000000000000000001";
const DOM_A = "dom_00000000000000000000000001";
const DOM_APP = "dom_00000000000000000000000002";

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
  writeFileSync(join(folderB, "LOPHN.md"), "rules of B");
  mkdirSync(join(root, "projects", PRJ_C), { recursive: true });
  writeFileSync(join(root, "projects", PRJ_C, "LOPHN.md"), "rules of C");
  const db = new DatabaseSync(join(root, "ledger.db"));
  for (const step of [
    ...projectsSchemaSteps,
    ...conversationSchemaSteps,
    ...domainsSchemaSteps,
  ]) {
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
  // project C는 등록 폴더가 없다. 지침은 <data>/projects/<prj>/LOPHN.md다.
  db.prepare(
    "insert into projects values (?, 'c', 'c', '', '1', 'active')",
  ).run(PRJ_C);
  mkdirSync(join(root, "domains", DOM_A), { recursive: true });
  writeFileSync(join(root, "domains", DOM_A, "DOMAIN.md"), "doc of A");
  const addDomain = db.prepare(
    "insert into domains values (?, ?, ?, '', ?, ?, '1', 'active')",
  );
  addDomain.run(DOM_A, "da", "da", "project", PRJ_A);
  addDomain.run(DOM_APP, "dapp", "dapp", "app", APP);
  const insert = db.prepare(
    `insert into sessions (id, agent, project, app, place_kind, place_id,
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
  return { root, snapshot };
}

function read(snapshot: ReadSnapshot, session: number, project?: string) {
  const handler = createReaderRegistration().reads[0] as ReadDefinition<
    typeof instructionsGet
  >;
  const result = handler.handle(
    snapshot,
    {} as never,
    { session: sessionId(session), layer: "project", project } as never,
  );
  if (!result.ok) return result.error.code;
  const file = result.value.file;
  return file === null ? null : atob(file.content_base64);
}

test("home session만 다른 project의 LOPHN.md를 읽는다", () => {
  const { root, snapshot } = setup();
  try {
    const table: [number, string | undefined, string | null][] = [
      // [session, 요청한 project, 결과]
      [1, undefined, null], // home session은 place가 없어 project 지침이 비어 있다
      [1, PRJ_A, "rules of A"], // home session은 어느 project든 읽는다
      [1, PRJ_B, "rules of B"],
      [2, undefined, "rules of A"],
      [2, PRJ_A, "rules of A"],
      [2, PRJ_B, "forbidden"],
      [3, undefined, null], // 앱 그릇에는 LOPHN.md가 없다
      [3, PRJ_A, "forbidden"],
      [1, PRJ_C, "rules of C"], // 폴더 없는 project는 data 자리의 파일이다
      [4, undefined, "rules of C"],
    ];
    for (const [session, project, expected] of table) {
      assert.deepStrictEqual(
        read(snapshot, session, project),
        expected,
        `${session} ${project}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("domain 층은 session의 place 그릇에 든 domain의 DOMAIN.md만 읽는다", () => {
  const { root, snapshot } = setup();
  try {
    const handler = createReaderRegistration().reads[0] as ReadDefinition<
      typeof instructionsGet
    >;
    const of = (session: number, domain: string | undefined) => {
      const result = handler.handle(
        snapshot,
        {} as never,
        { session: sessionId(session), layer: "domain", domain } as never,
      );
      if (!result.ok) return result.error.code;
      return result.value.file === null
        ? null
        : atob(result.value.file.content_base64);
    };
    assert.deepStrictEqual(of(2, DOM_A), "doc of A"); // project A session은 자기 project의 domain
    assert.deepStrictEqual(of(4, DOM_A), "forbidden"); // 다른 project session
    assert.deepStrictEqual(of(1, DOM_A), "forbidden"); // home session은 place가 없다
    assert.deepStrictEqual(of(3, DOM_A), "forbidden"); // app session은 다른 그릇
    assert.deepStrictEqual(of(3, DOM_APP), null); // 자기 앱의 domain, 파일은 아직 없다
    assert.deepStrictEqual(of(2, undefined), "invalid_input");
  } finally {
    rmSync(root, { recursive: true });
  }
});
