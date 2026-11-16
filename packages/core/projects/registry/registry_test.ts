import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import { TargetAuthorization } from "../../../protocol/server/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createProjectCommands } from "./commands.ts";
import { PROJECT_IDENTITY_CONTEXT } from "./contexts.ts";
import { createFolderResolver } from "./folder-resolver.ts";
import { folderResolverPort } from "./ports.ts";
import { PROJECTS_IDENTITY_STEPS, projectsSchemaSteps } from "./schema.ts";
import { loadProject } from "./store.ts";

const user: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

// 저장소만 쓴다. 표는 실제 schema step 그대로고 폴더는 실제 임시 폴더다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...projectsSchemaSteps, ...PROJECTS_IDENTITY_STEPS]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const resolver = createFolderResolver();
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [folderResolverPort, resolver],
  ]);
  const tx = {
    sql,
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  return { db, sql, tx, commands: createProjectCommands() };
}

const PROJECT = "prj_00000000000000000000000001";

function input(folders: unknown, id = PROJECT, name = "notes") {
  return {
    id,
    name,
    title: "Notes",
    purpose: "keep notes",
    folders,
  } as never;
}

test("폴더 없이도 등록된다", () => {
  const { db, tx, commands } = setup();
  try {
    const empty = commands.register.handle(tx, user, input([]), {});
    assert.ok(empty.ok);
    assert.deepStrictEqual(empty.value.folders, []);
  } finally {
    db.close();
  }
});

test("보관해도 폴더의 파일은 그대로다", () => {
  const { db, tx, commands } = setup();
  const root = mkdtempSync(join(tmpdir(), "lophn-registry-"));
  try {
    writeFileSync(join(root, "note.md"), "hello");
    const registered = commands.register.handle(
      tx,
      user,
      input([{ path: root, description: "" }]),
      {},
    );
    assert.ok(registered.ok);

    const archived = commands.archive.handle(
      tx,
      user,
      { project: PROJECT },
      { base_revision: registered.value.revision },
    );
    assert.ok(archived.ok);
    assert.deepStrictEqual(archived.value.status, "archived");
    assert.deepStrictEqual(
      readFileSync(join(root, "note.md"), "utf8"),
      "hello",
    );

    const back = commands.unarchive.handle(
      tx,
      user,
      { project: PROJECT },
      { base_revision: archived.value.revision },
    );
    assert.ok(back.ok);
    assert.deepStrictEqual(back.value.status, "active");
    assert.deepStrictEqual(back.value.folders[0]!.found, true);
  } finally {
    db.close();
    rmSync(root, { recursive: true });
  }
});

test("새 identity step을 지나도 기존 project와 그 id를 key로 쓰는 행이 그대로이고 identity는 null이다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of projectsSchemaSteps) db.exec(step.sql);
    db.exec(
      "CREATE TABLE notes_of (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id)) STRICT",
    );
    db.prepare(
      "INSERT INTO projects (id, name, title, purpose, revision, status) VALUES (?, 'notes', 'Notes', 'keep', '3', 'archived')",
    ).run(PROJECT);
    db.prepare(
      "INSERT INTO project_folders (project, position, path, description) VALUES (?, 0, '/srv/notes', 'root')",
    ).run(PROJECT);
    db.prepare("INSERT INTO notes_of (id, project) VALUES ('n1', ?)").run(
      PROJECT,
    );

    for (const step of PROJECTS_IDENTITY_STEPS) db.exec(step.sql);

    const sql = {
      get: (query: string, params: never[]) => db.prepare(query).get(...params),
      all: (query: string, params: never[]) => db.prepare(query).all(...params),
    } as unknown as Sql;
    const project = loadProject(sql, PROJECT);
    assert.ok(project.ok);
    assert.deepStrictEqual(project.value, {
      id: PROJECT,
      name: "notes",
      title: "Notes",
      purpose: "keep",
      revision: "3",
      status: "archived",
      folders: [{ path: "/srv/notes", description: "root" }],
      identity: null,
      repo: null,
      remote: null,
    });
    assert.deepStrictEqual(
      { ...db.prepare("SELECT id, project FROM notes_of").get() },
      { id: "n1", project: PROJECT },
    );
  } finally {
    db.close();
  }
});

const SECOND = "prj_00000000000000000000000002";
const SHARED = "pri_00000000000000000000000001";

function record(project: string, file_identity: string | null) {
  return {
    project,
    found: true,
    repo: "git" as const,
    file_identity,
    remote: { key: "github.com/me/notes", url: "git@github.com:me/notes.git" },
  };
}

test("record_identity: 없는 file은 id를 지우지 않고, 한 기계에서 한 id는 project 하나만 갖는다", () => {
  const { db, tx, commands } = setup();
  const machine = PROJECT_IDENTITY_CONTEXT;
  try {
    const first = commands.register.handle(
      tx,
      user,
      input([{ path: "/srv/notes", description: "" }]),
      {},
    );
    assert.ok(first.ok);
    const second = commands.register.handle(
      tx,
      user,
      input([{ path: "/srv/notes-copy", description: "" }], SECOND, "copy"),
      {},
    );
    assert.ok(second.ok);
    const folders = () =>
      db
        .prepare("SELECT project, path FROM project_folders ORDER BY project")
        .all()
        .map((row) => ({ ...row }));
    const foldersBefore = folders();

    const read = commands.recordIdentity.handle(
      tx,
      machine,
      record(PROJECT, SHARED),
      {},
    );
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value.identity, SHARED);
    assert.deepStrictEqual(read.value.remote?.key, "github.com/me/notes");

    // file이 없어졌다(지웠거나 file 없는 branch). 읽지 못한 폴더도 마찬가지다.
    const gone = commands.recordIdentity.handle(
      tx,
      machine,
      record(PROJECT, null),
      {},
    );
    assert.ok(gone.ok);
    assert.deepStrictEqual(gone.value.identity, SHARED);
    const unfound = commands.recordIdentity.handle(
      tx,
      machine,
      { ...record(PROJECT, null), found: false, repo: null, remote: null },
      {},
    );
    assert.ok(unfound.ok);
    assert.deepStrictEqual(unfound.value.identity, SHARED);
    assert.deepStrictEqual(unfound.value.repo, "git");

    // 같은 저장소의 두 번째 copy는 id 없이 남는다.
    const copy = commands.recordIdentity.handle(
      tx,
      machine,
      record(SECOND, SHARED),
      {},
    );
    assert.ok(copy.ok);
    assert.deepStrictEqual(copy.value.identity, null);

    // 보관한 holder는 같은 id를 읽은 active project에 넘긴다.
    const archived = commands.archive.handle(
      tx,
      user,
      { project: PROJECT },
      { base_revision: first.value.revision },
    );
    assert.ok(archived.ok);
    const moved = commands.recordIdentity.handle(
      tx,
      machine,
      record(SECOND, SHARED),
      {},
    );
    assert.ok(moved.ok);
    assert.deepStrictEqual(moved.value.identity, SHARED);
    assert.deepStrictEqual(moved.value.revision, second.value.revision);
    const holder = loadProject(tx.sql, PROJECT);
    assert.ok(holder.ok);
    assert.deepStrictEqual(holder.value?.identity, null);
    assert.deepStrictEqual(holder.value?.revision, archived.value.revision);

    assert.deepStrictEqual(folders(), foldersBefore);
    assert.deepStrictEqual(
      db
        .prepare("SELECT id FROM projects ORDER BY id")
        .all()
        .map((row) => row.id),
      [PROJECT, SECOND],
    );
  } finally {
    db.close();
  }
});

test("record_identity는 machine:projects-identity 자격만 받는다", () => {
  const { db, tx, commands } = setup();
  try {
    assert.ok(commands.register.handle(tx, user, input([]), {}).ok);
    const other = {
      ...PROJECT_IDENTITY_CONTEXT,
      principal: "machine:apps-source",
      credential_ref: "machine:apps-source",
    };
    for (const ctx of [user, other]) {
      const result = commands.recordIdentity.handle(
        tx,
        ctx,
        record(PROJECT, SHARED),
        {},
      );
      assert.ok(!result.ok);
      assert.deepStrictEqual(result.error.code, "forbidden");
    }
    const loaded = loadProject(tx.sql, PROJECT);
    assert.ok(loaded.ok);
    assert.deepStrictEqual(loaded.value?.identity, null);
  } finally {
    db.close();
  }
});
