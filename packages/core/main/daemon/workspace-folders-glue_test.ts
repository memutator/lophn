import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { workspaceFoldersOf } from "./workspace-folders-glue.ts";

const PRJ = "prj_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const PRJ_B = "prj_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const APP = "app_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const AGT = "agt_0aaaaaaaaaaaaaaaaaaaaaaaaa";

// 다른 그릇의 폴더나 앱 source가 rewind 쓰기 폴더에 들어오면 남의 앱이나 project를 쓰게 된다.
// memory 폴더는 rewind에만 열고 file tool 범위(workspaceScope)에는 열지 않으므로 이 목록에만 더해진다.
test("project·app session의 rewind 쓰기 폴더는 자기 그릇의 폴더와 자기 memory 폴더뿐이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, agent text, workspace_kind text, workspace_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table app_folders (app text, path text, position integer);
    insert into sessions values ('ses_pm', 'lophn_${PRJ}', 'project', '${PRJ}');
    insert into sessions values ('ses_ae', '${AGT}', 'app', '${APP}');
    insert into sessions values ('ses_home', 'lophn_home', null, null);
    insert into apps values ('${APP}', '${PRJ}', '/src/a', 'active');
    insert into apps values ('app_b', '${PRJ_B}', '/src/b', 'active');
    insert into project_folders values ('${PRJ}', '/work/a', 0);
    insert into project_folders values ('${PRJ_B}', '/work/b', 0);
    insert into app_folders values ('${APP}', '/shared/a', 0);
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
    `/data/projects/${PRJ}/workflows`,
    `/data/projects/${PRJ}/skills`,
    `/data/projects/${PRJ}/artifacts`,
    `/data/projects/${PRJ}`,
  ]);
  // 사람이 만든 agent는 자기 agent memory 폴더만 더한다. workspace memory 폴더는 열리지 않는다.
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_ae"), [
    "/src/a",
    "/shared/a",
    `/data/apps/${APP}/skills`,
    `/data/apps/${APP}/artifacts`,
    "/data/agent-memory",
  ]);
  // home은 자기 skills/와 Home memory 폴더만 쓴다
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_home"), [
    "/data/home/skills",
    "/data/home",
  ]);
  assert.deepStrictEqual(
    workspaceFoldersOf({ sql }, "/data", "ses_missing"),
    [],
  );
});
