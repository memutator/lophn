import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { placeFoldersOf } from "./place-folders-glue.ts";

// rewind의 쓰기 폴더는 그릇의 domain 폴더 전부다. 다른 그릇의 domain 폴더나 앱 source가 들어오면 남의 앱이나 domain을 쓰게 된다.
test("project·app session의 rewind 쓰기 폴더는 자기 그릇의 폴더와 그 그릇의 domain 폴더 전부뿐이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, agent text, place_kind text, place_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table domains (id text, name text, owner_kind text, owner_id text, status text);
    insert into sessions values ('ses_pm', 'lophn', 'project', 'prj_a');
    insert into sessions values ('ses_ae', 'agt_1', 'app', 'app_a');
    insert into sessions values ('ses_home', 'lophn', null, null);
    insert into apps values ('app_a', 'prj_a', '/src/a', 'active');
    insert into apps values ('app_b', 'prj_b', '/src/b', 'active');
    insert into project_folders values ('prj_a', '/work/a', 0);
    insert into project_folders values ('prj_b', '/work/b', 0);
    insert into domains values ('dom_pa', 'pa', 'project', 'prj_a', 'active');
    insert into domains values ('dom_pb', 'pb', 'project', 'prj_b', 'active');
    insert into domains values ('dom_aa', 'aa', 'app', 'app_a', 'active');
    insert into domains values ('dom_ab', 'ab', 'app', 'app_b', 'active');
  `);
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  assert.deepStrictEqual(placeFoldersOf({ sql }, "/data", "ses_pm"), [
    "/work/a",
    "/data/domains/dom_pa",
    "/data/projects/prj_a/workflows",
  ]);
  assert.deepStrictEqual(placeFoldersOf({ sql }, "/data", "ses_ae"), [
    "/src/a",
    "/data/domains/dom_aa",
  ]);
  assert.deepStrictEqual(placeFoldersOf({ sql }, "/data", "ses_home"), []);
  assert.deepStrictEqual(placeFoldersOf({ sql }, "/data", "ses_missing"), []);
});
