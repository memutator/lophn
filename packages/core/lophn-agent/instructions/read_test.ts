import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { ReadSnapshot } from "../../../protocol/server/mod.ts";
import { projectsSchemaSteps } from "../../projects/registry/schema.ts";
import { conversationSchemaSteps } from "../session/model.ts";
import { instructionsGetHandler } from "./files.ts";

const PRJ_A = "prj_00000000000000000000000001";
const PRJ_B = "prj_00000000000000000000000002";
const APP = "app_00000000000000000000000001";

function sessionId(n: number) {
  return `ses_${String(n).padStart(26, "0")}`;
}

// 임시 폴더에 project 폴더 둘과 앱 source 폴더(project A 안), 실제 schema의 ledger 파일을 만든다.
function setup() {
  const root = Deno.makeTempDirSync();
  const folderA = join(root, "a");
  const folderB = join(root, "b");
  Deno.mkdirSync(join(folderA, "apps", "notes"), { recursive: true });
  Deno.mkdirSync(folderB);
  Deno.writeTextFileSync(join(folderA, "LOPHN.md"), "rules of A");
  Deno.writeTextFileSync(join(folderB, "LOPHN.md"), "rules of B");
  const db = new DatabaseSync(join(root, "ledger.db"));
  for (const step of [...projectsSchemaSteps, ...conversationSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec("create table apps (id text primary key, source_path text)");
  for (
    const [id, name, folder] of [[PRJ_A, "a", folderA], [PRJ_B, "b", folderB]]
  ) {
    db.prepare(
      "insert into projects values (?, ?, ?, '', '1', 'active')",
    ).run(id, name, name);
    db.prepare("insert into project_folders values (?, 0, ?, '')").run(
      id,
      folder,
    );
  }
  db.prepare("insert into apps values (?, ?)").run(
    APP,
    join(folderA, "apps", "notes"),
  );
  const insert = db.prepare(
    `insert into sessions (id, role, project, app, place_kind, place_id,
       created_seq, state_seq) values (?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  insert.run(sessionId(1), "lophn", null, null, null, null);
  insert.run(sessionId(2), "project_manager", PRJ_A, null, "project", PRJ_A);
  insert.run(sessionId(3), "app_engineer", null, APP, "app", APP);
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
  const handler = instructionsGetHandler();
  const result = handler.handle(
    snapshot,
    {} as never,
    { session: sessionId(session), layer: "project", project } as never,
  );
  if (!result.ok) return result.error.code;
  const file = result.value.file;
  return file === null ? null : atob(file.content_base64);
}

Deno.test("lophn이 아닌 role은 자기 place 밖 project의 LOPHN.md를 읽지 못한다", () => {
  const { root, snapshot } = setup();
  try {
    const table: [number, string | undefined, string | null][] = [
      // [session, 요청한 project, 결과]
      [1, undefined, null], // lophn은 place가 없어 project 지침이 비어 있다
      [1, PRJ_A, "rules of A"], // lophn은 어느 project든 읽는다
      [1, PRJ_B, "rules of B"],
      [2, undefined, "rules of A"],
      [2, PRJ_A, "rules of A"],
      [2, PRJ_B, "forbidden"],
      [3, undefined, "rules of A"], // 앱 source가 project A 안에 있다
      [3, PRJ_A, "rules of A"],
      [3, PRJ_B, "forbidden"],
    ];
    for (const [session, project, expected] of table) {
      assertEquals(
        read(snapshot, session, project),
        expected,
        `${session} ${project}`,
      );
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
