import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  sessionFoldersOf,
  workspaceBaseOf,
  workspaceFoldersOf,
  workspaceReadScopeOf,
} from "./workspace-folders-glue.ts";

const PRJ = "prj_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const PRJ_B = "prj_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const APP = "app_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const AGT = "agt_0aaaaaaaaaaaaaaaaaaaaaaaaa";

// 다른 그릇의 폴더나 앱 source가 rewind 쓰기 폴더에 들어오면 남의 앱이나 project를 쓰게 된다.
// memory 폴더는 rewind에만 열고 file tool 범위(workspaceScope)에는 열지 않으므로 이 목록에만 더해진다.
test("project·app session의 rewind 쓰기 폴더는 자기 그릇의 폴더와 자기 memory 폴더뿐이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, agent text, workspace_kind text, workspace_id text, worktree_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table app_folders (app text, path text, position integer);
    insert into sessions values ('ses_pm', 'lophn_${PRJ}', 'project', '${PRJ}', null);
    insert into sessions values ('ses_ae', '${AGT}', 'app', '${APP}', null);
    insert into sessions values ('ses_home', 'lophn_home', null, null, null);
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
    `/data/projects/${PRJ}/tools`,
    `/data/projects/${PRJ}/artifacts`,
    `/data/projects/${PRJ}`,
  ]);
  // 사람이 만든 agent는 자기 agent memory 폴더만 더한다. workspace memory 폴더는 열리지 않는다.
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_ae"), [
    "/src/a",
    "/shared/a",
    `/data/apps/${APP}/skills`,
    `/data/apps/${APP}/tools`,
    `/data/apps/${APP}/artifacts`,
    "/data/agent-memory",
  ]);
  // home은 자기 skills/, tools/, 전역 개인 skill 보관소와 Home memory 폴더만 쓴다
  assert.deepStrictEqual(workspaceFoldersOf({ sql }, "/data", "ses_home"), [
    "/data/home/skills",
    "/data/home/tools",
    "/data/skills",
    "/data/home",
  ]);
  assert.deepStrictEqual(
    workspaceFoldersOf({ sql }, "/data", "ses_missing"),
    [],
  );
  // `!` bash mode의 cwd: project는 첫 폴더, Home은 OS home 폴더, 없는 session은 undefined다.
  const home = () => "/home/tester";
  assert.equal(workspaceBaseOf({ sql }, "/data", "ses_pm", home), "/work/a");
  assert.equal(
    workspaceBaseOf({ sql }, "/data", "ses_home", home),
    "/home/tester",
  );
  assert.equal(
    workspaceBaseOf({ sql }, "/data", "ses_missing", home),
    undefined,
  );
});

// 이 규칙이 깨지면 worktree가 missing·removed가 된 뒤 rewind나 기본 cwd가 원래 저장소 루트(main checkout)로 폴백된다.
test("worktree가 묶인 project session은 worktree가 ready가 아니면 원래 repo_root로 폴백하지 않는다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table sessions (id text, agent text, workspace_kind text, workspace_id text, called_from_kind text, worktree_id text);
    create table apps (id text, project text, source_path text, status text);
    create table project_folders (project text, path text, position integer);
    create table app_folders (app text, path text, position integer);
    create table project_worktrees (id text, project_id text, repo_root text, path text, branch text, status text);
    insert into project_folders values ('${PRJ}', '/work/repo', 0);
    insert into project_folders values ('${PRJ}', '/work/extra', 1);
    insert into project_worktrees values ('wkt_ready', '${PRJ}', '/work/repo', '/data/worktrees/r/b-1', 'wt/a', 'ready');
    insert into project_worktrees values ('wkt_missing', '${PRJ}', '/work/repo', '/data/worktrees/r/b-2', 'wt/b', 'missing');
    insert into project_worktrees values ('wkt_removed', '${PRJ}', '/work/repo', '/data/worktrees/r/b-3', 'wt/c', 'removed');
    insert into sessions values ('ses_ready', 'lophn_${PRJ}', 'project', '${PRJ}', null, 'wkt_ready');
    insert into sessions values ('ses_missing_wt', 'lophn_${PRJ}', 'project', '${PRJ}', null, 'wkt_missing');
    insert into sessions values ('ses_removed_wt', 'lophn_${PRJ}', 'project', '${PRJ}', null, 'wkt_removed');
    insert into sessions values ('ses_gone_row', 'lophn_${PRJ}', 'project', '${PRJ}', null, 'wkt_unknown');
  `);
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };

  // ready: repo_root가 worktree 경로로 치환된다.
  const readyWrite = workspaceFoldersOf({ sql }, "/data", "ses_ready");
  assert.ok(readyWrite.includes("/data/worktrees/r/b-1"));
  assert.ok(readyWrite.includes("/work/extra"));
  assert.ok(!readyWrite.includes("/work/repo"));
  assert.equal(
    workspaceBaseOf({ sql }, "/data", "ses_ready"),
    "/data/worktrees/r/b-1",
  );

  // missing / removed: 원래 repo_root가 쓰기·읽기·base 모두에서 제외된다.
  for (const ses of ["ses_missing_wt", "ses_removed_wt"]) {
    const write = workspaceFoldersOf({ sql }, "/data", ses);
    const read = workspaceReadScopeOf({ sql }, "/data", ses);
    const info = sessionFoldersOf({ sql }, "/data", ses);
    assert.ok(!write.includes("/work/repo"), `${ses} write must exclude repo`);
    assert.ok(
      !read?.read.includes("/work/repo"),
      `${ses} read must exclude repo`,
    );
    assert.ok(
      !info.folders.includes("/work/repo"),
      `${ses} folders must exclude repo`,
    );
    assert.notEqual(workspaceBaseOf({ sql }, "/data", ses), "/work/repo");
    assert.notEqual(info.cwd, "/work/repo");
    assert.ok(write.includes("/work/extra"));
  }

  // worktree 행 자체가 없으면 어느 폴더가 repo_root인지 알 수 없으므로 project 폴더 전체를 제외한다.
  const goneWrite = workspaceFoldersOf({ sql }, "/data", "ses_gone_row");
  const goneRead = workspaceReadScopeOf({ sql }, "/data", "ses_gone_row");
  assert.ok(!goneWrite.includes("/work/repo"));
  assert.ok(!goneWrite.includes("/work/extra"));
  assert.ok(!goneRead?.read.includes("/work/repo"));
  assert.equal(
    workspaceBaseOf({ sql }, "/data", "ses_gone_row"),
    `/data/projects/${PRJ}`,
  );
});
