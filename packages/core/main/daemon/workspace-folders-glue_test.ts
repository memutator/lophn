import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { workspaceFoldersOf } from "./workspace-folders-glue.ts";

// 다른 그릇의 폴더나 앱 source가 rewind 쓰기 폴더에 들어오면 남의 앱이나 project를 쓰게 된다.
test("project·app session의 rewind 쓰기 폴더는 자기 그릇의 폴더뿐이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, agent text, workspace_kind text, workspace_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table app_folders (app text, path text, position integer);
    insert into sessions values ('ses_pm', 'lophn', 'project', 'prj_a');
    insert into sessions values ('ses_ae', 'agt_1', 'app', 'app_a');
    insert into sessions values ('ses_home', 'lophn', null, null);
    insert into apps values ('app_a', 'prj_a', '/src/a', 'active');
    insert into apps values ('app_b', 'prj_b', '/src/b', 'active');
    insert into project_folders values ('prj_a', '/work/a', 0);
    insert into project_folders values ('prj_b', '/work/b', 0);
    insert into app_folders values ('app_a', '/shared/a', 0);
    insert into app_folders values ('app_b', '/shared/b', 0);
  `);
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_pm"), [
    "/work/a",
    "/data/projects/prj_a/workflows",
    "/data/projects/prj_a/skills",
    "/data/projects/prj_a/artifacts",
  ]);
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_ae"), [
    "/src/a",
    "/shared/a",
    "/data/apps/app_a/skills",
    "/data/apps/app_a/artifacts",
  ]);
  // home은 자기 skills/만 쓴다
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_home"), [
    "/data/home/skills",
  ]);
  assert.deepStrictEqual(
    workspaceFoldersOf({ sql }, "/data", "ses_missing"),
    [],
  );
});
