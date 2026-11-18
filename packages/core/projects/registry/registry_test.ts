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
import { createProjectReads } from "./reads.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  projectsSchemaSteps,
} from "./schema.ts";
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
  for (const step of [
    ...projectsSchemaSteps,
    ...PROJECTS_IDENTITY_STEPS,
    ...PROJECTS_FORMER_IDENTITY_STEPS,
  ]) {
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
  let born = 0;
  const tx = {
    sql,
    port: (key: unknown) => ports.get(key),
    newId: () =>
      `pri_0000000000000000000000b${String(++born).padStart(3, "0")}`,
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

test("새 identity step들을 지나도 기존 project와 그 id를 key로 쓰는 행이 그대로이고, 읽은 identity·repo는 그대로이며 옛 identity는 빈 목록이다", () => {
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
    const second = "prj_00000000000000000000000002";
    db.prepare(
      "INSERT INTO projects (id, name, title, purpose, revision, status, identity, repo) VALUES (?, 'plain', 'Plain', '', '1', 'active', 'pri_00000000000000000000000009', 'none')",
    ).run(second);
    for (const step of PROJECTS_FORMER_IDENTITY_STEPS) db.exec(step.sql);

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
      former_identities: [],
      repo: null,
      remote: null,
    });
    const plain = loadProject(sql, second);
    assert.ok(plain.ok);
    assert.deepStrictEqual(
      {
        identity: plain.value?.identity,
        repo: plain.value?.repo,
        former: plain.value?.former_identities,
      },
      { identity: "pri_00000000000000000000000009", repo: "none", former: [] },
    );
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

const THIRD = "prj_00000000000000000000000003";
const LINKED = "pri_00000000000000000000000002";

function plain(project: string) {
  return {
    project,
    found: true,
    repo: "none" as const,
    file_identity: null,
    remote: null,
  };
}

test("link_identity: git project의 identity는 바꾸지 못하고, 다른 project가 지금이나 옛 identity로 가진 id는 적지 못하며, 적은 id는 다시 읽어도 남는다", () => {
  const { db, tx, commands } = setup();
  const machine = PROJECT_IDENTITY_CONTEXT;
  try {
    const reason = (result: {
      ok: boolean;
      error?: { code: string; details?: Record<string, unknown> };
    }) =>
      result.ok
        ? "ok"
        : `${result.error?.code}:${result.error?.details?.reason}`;
    const register = (id: string, name: string, path: string) => {
      const done = commands.register.handle(
        tx,
        user,
        input([{ path, description: "" }], id, name),
        {},
      );
      assert.ok(done.ok);
    };
    register(PROJECT, "notes", "/srv/notes");
    register(SECOND, "plain", "/srv/plain");
    register(THIRD, "other", "/srv/other");
    assert.ok(
      commands.recordIdentity.handle(tx, machine, record(PROJECT, SHARED), {})
        .ok,
    );
    const born = commands.recordIdentity.handle(tx, machine, plain(SECOND), {});
    assert.ok(born.ok && born.value.identity !== null);
    const bornId = born.value.identity;
    assert.ok(commands.recordIdentity.handle(tx, machine, plain(THIRD), {}).ok);

    // git project는 id file이 정한다. 아직 읽지 않은(repo null) project도 git일 수 있어 같다.
    const git = commands.linkIdentity.handle(
      tx,
      user,
      { project: PROJECT, identity: LINKED },
      {},
    );
    assert.equal(reason(git), "conflict:git_project");
    const kept = loadProject(tx.sql, PROJECT);
    assert.ok(kept.ok);
    assert.equal(kept.value?.identity, SHARED);

    const taken = commands.linkIdentity.handle(
      tx,
      user,
      { project: SECOND, identity: SHARED },
      {},
    );
    assert.equal(reason(taken), "conflict:identity_in_use");

    const linked = commands.linkIdentity.handle(
      tx,
      user,
      { project: SECOND, identity: LINKED },
      {},
    );
    assert.ok(linked.ok);
    assert.equal(linked.value.identity, LINKED);
    assert.equal(linked.value.revision, born.value.revision);

    // SECOND의 옛 identity도 그 project의 것이다(보관해도 같다).
    const archived = commands.archive.handle(
      tx,
      user,
      { project: SECOND },
      { base_revision: linked.value.revision },
    );
    assert.ok(archived.ok);
    const former = commands.linkIdentity.handle(
      tx,
      user,
      { project: THIRD, identity: bornId },
      {},
    );
    assert.equal(reason(former), "conflict:identity_in_use");

    const reread = commands.recordIdentity.handle(
      tx,
      machine,
      plain(SECOND),
      {},
    );
    assert.ok(reread.ok);
    assert.equal(reread.value.identity, LINKED);
    const again = commands.linkIdentity.handle(
      tx,
      user,
      { project: SECOND, identity: LINKED },
      {},
    );
    assert.ok(again.ok);
    assert.deepStrictEqual(again.value.former_identities, [bornId]);
    // agent는 잇지 못한다.
    const agent = commands.linkIdentity.handle(
      tx,
      { ...user, actor: "agent:agt_00000000000000000000000001" },
      { project: THIRD, identity: "pri_00000000000000000000000003" },
      {},
    );
    assert.equal(reason(agent), "forbidden:undefined");
  } finally {
    db.close();
  }
});

test("잇기와 renew 뒤 다시 읽기로 identity가 바뀌면 project.list가 옛 identity를 싣는다", () => {
  const { db, sql, tx, commands } = setup();
  const machine = PROJECT_IDENTITY_CONTEXT;
  try {
    for (const [id, name] of [
      [PROJECT, "notes"],
      [SECOND, "plain"],
    ] as const) {
      assert.ok(
        commands.register.handle(
          tx,
          user,
          input([{ path: `/srv/${name}`, description: "" }], id, name),
          {},
        ).ok,
      );
    }
    const born = commands.recordIdentity.handle(tx, machine, plain(SECOND), {});
    assert.ok(born.ok);
    assert.ok(
      commands.linkIdentity.handle(
        tx,
        user,
        { project: SECOND, identity: LINKED },
        {},
      ).ok,
    );
    // renew: file에 새 id를 쓴 뒤 다시 읽는다.
    const renewed = "pri_00000000000000000000000004";
    for (const file of [SHARED, renewed]) {
      assert.ok(
        commands.recordIdentity.handle(tx, machine, record(PROJECT, file), {})
          .ok,
      );
    }

    const reads = createProjectReads({ folders: createFolderResolver() });
    const listed = reads.list.handle(
      { sql, as_of_seq: "1", port: tx.port } as never,
      user,
      {},
    );
    assert.ok(listed.ok);
    assert.deepStrictEqual(
      listed.value.projects.map((project) => [
        project.id,
        project.identity,
        project.former_identities,
      ]),
      [
        [PROJECT, renewed, [SHARED]],
        [SECOND, LINKED, [born.value.identity]],
      ],
    );
  } finally {
    db.close();
  }
});
