// lophn-agent/instructions#R2 R4: ReadInstructionFile의 허락 판정(instructionAccess). run의 assignment preset이
// 붙인 지침 문서와 run의 작업 자리(세션이 있으면 세션, 없으면 assignment 범위)만 읽게 하고 그 밖은
// not_found다. ledger 모양의 temp DB로 본다.
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { instructionAccess } from "./instruction-files.ts";

const RUN_SESSION = "run_a";
const RUN_PLAIN = "run_b";
const PROJECT = "prj_a";
const ATTACHED = "doc_attached";
const OLD_ATTACHED = "doc_old";
const OTHER = "doc_other";

async function seeded() {
  const dir = await Deno.makeTempDir({ prefix: "lophn-instr-access-" });
  const path = `${dir}/lophn.db`;
  const db = new DatabaseSync(path);
  db.exec(`
    create table runs (id text primary key, assignment text, session text);
    create table assignments (id text primary key, preset_id text, scope_kind text, scope_id text);
    create table sessions (id text primary key, work_place_kind text, work_place_id text);
    create table preset_revisions (preset_id text, revision integer, definition text);
    insert into assignments values ('asg_1', 'pst_1', 'all', null);
    insert into assignments values ('asg_2', 'pst_2', 'app', 'app_z');
    insert into sessions values ('ses_1', 'project', '${PROJECT}');
    insert into runs values ('${RUN_SESSION}', 'asg_1', 'ses_1');
    insert into runs values ('${RUN_PLAIN}', 'asg_2', null);
    insert into preset_revisions values ('pst_1', 1, '{"instructions":[{"document":"${OLD_ATTACHED}","order":0}]}');
    insert into preset_revisions values ('pst_1', 2, '{"instructions":[{"document":"${ATTACHED}","order":0}]}');
    insert into preset_revisions values ('pst_2', 1, '{"instructions":[]}');
  `);
  db.close();
  return { dir, path };
}

Deno.test("lophn-agent/instructions#R2 R4: 읽기는 run의 작업 자리와 그 run preset이 붙인 문서만 허락하고 나머지는 not_found다", async () => {
  const { dir, path } = await seeded();
  try {
    const permit = instructionAccess(path);
    const code = (result: ReturnType<typeof permit>) =>
      result.ok ? "ok" : result.error.code;
    // 전역은 어느 run이나 읽는다. 세션이 project에 있으면 그 project만 읽는다.
    assertEquals(
      code(permit({
        run: RUN_SESSION,
        location: { layer: "global", place: "global" },
      })),
      "ok",
    );
    assertEquals(
      code(permit({
        run: RUN_SESSION,
        location: { layer: "project", place: PROJECT },
      })),
      "ok",
    );
    assertEquals(
      code(permit({
        run: RUN_SESSION,
        location: { layer: "project", place: "prj_other" },
      })),
      "not_found",
    );
    assertEquals(
      code(permit({
        run: RUN_SESSION,
        location: { layer: "app", place: "app_z" },
      })),
      "not_found",
    );
    // 세션이 없으면 assignment 범위(app_z)가 작업 자리다.
    assertEquals(
      code(permit({
        run: RUN_PLAIN,
        location: { layer: "app", place: "app_z" },
      })),
      "ok",
    );
    assertEquals(
      code(permit({
        run: RUN_PLAIN,
        location: { layer: "project", place: PROJECT },
      })),
      "not_found",
    );
    // 붙은 문서는 그 run의 assignment preset의 어느 판이든 읽고, 다른 preset·붙지 않은 문서는 못 읽는다.
    assertEquals(code(permit({ run: RUN_SESSION, document: ATTACHED })), "ok");
    assertEquals(
      code(permit({ run: RUN_SESSION, document: OLD_ATTACHED })),
      "ok",
    );
    assertEquals(
      code(permit({ run: RUN_SESSION, document: OTHER })),
      "not_found",
    );
    assertEquals(
      code(permit({ run: RUN_PLAIN, document: ATTACHED })),
      "not_found",
    );
    assertEquals(
      code(permit({ run: "run_none", document: ATTACHED })),
      "not_found",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
