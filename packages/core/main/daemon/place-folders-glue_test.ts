import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { placeFoldersOf } from "./place-folders-glue.ts";

// PM의 file 범위는 자기 project의 폴더·앱 source·skill 폴더뿐이다. 다른 project의 앱 source도, 자기 project의 `app/`
// (앱 data·release 사본)도 들어오면 PM이 남의 앱이나 앱 data를 쓰게 된다.
Deno.test("PM의 쓰기 폴더는 자기 project의 폴더, 앱 source, skill 폴더뿐이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, role text, place_kind text, place_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table contexts (id text, project text);
    create table context_bundles (id text, context text, status text);
    insert into sessions values ('ses_a', 'project_manager', 'project', 'prj_a');
    insert into sessions values ('ses_b', 'project_manager', 'project', 'prj_b');
    insert into apps values ('app_a', 'prj_a', '/src/a', 'active');
    insert into apps values ('app_b', 'prj_b', '/src/b', 'active');
    insert into project_folders values ('prj_a', '/work/a', 0);
    insert into project_folders values ('prj_b', '/work/b', 0);
  `);
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  assertEquals(placeFoldersOf({ sql }, "/data", "ses_a"), [
    "/work/a",
    "/data/projects/prj_a/artifacts",
    // kinds 파일은 rewind root로 부모 폴더가 된다. 쓰기는 file tool이 그 파일 하나로 좁힌다
    "/data/projects/prj_a",
    "/src/a",
    "/data/projects/prj_a/skills",
  ]);
  assertEquals(placeFoldersOf({ sql }, "/data", "ses_b"), [
    "/work/b",
    "/data/projects/prj_b/artifacts",
    // kinds 파일은 rewind root로 부모 폴더가 된다. 쓰기는 file tool이 그 파일 하나로 좁힌다
    "/data/projects/prj_b",
    "/src/b",
    "/data/projects/prj_b/skills",
  ]);
});
