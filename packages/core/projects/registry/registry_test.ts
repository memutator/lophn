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
import { assignMissingIdentities, loadProject } from "./store.ts";

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
      run: (query: string, params: never[]) => db.prepare(query).run(...params),
    } as unknown as Sql;
    // 옛 행은 identity가 비어 있다. data step이 채운 뒤 읽힌다.
    assert.deepStrictEqual(
      {
        ...db
          .prepare(
            "SELECT identity, repo, former_identities FROM projects WHERE id = ?",
          )
          .get(PROJECT),
      },
      { identity: null, repo: null, former_identities: "[]" },
    );
    assignMissingIdentities(
      sql as never,
      {
        newId: () => "pri_00000000000000000000000008",
      } as never,
    );
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
      identity: "pri_00000000000000000000000008",
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
const THIRD = "prj_00000000000000000000000003";
const LINKED = "pri_00000000000000000000000002";
const REMOTE = {
  key: "github.com/me/notes",
  url: "git@github.com:me/notes.git",
};

function record(
  project: string,
  repo: "git" | "none" = "git",
  remote: typeof REMOTE | null = repo === "git" ? REMOTE : null,
) {
  return { project, found: true, repo, remote };
}

test("record_identity는 git 여부와 remote만 적고 identity는 바꾸지 않으며, 폴더를 읽지 못하면 아무것도 바꾸지 않고, machine:projects-identity 자격만 받는다", () => {
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
    assert.notEqual(first.value.identity, second.value.identity);

    // 같은 저장소를 읽은 두 project는 각자 id를 둔다.
    for (const project of [PROJECT, SECOND]) {
      const read = commands.recordIdentity.handle(
        tx,
        machine,
        record(project),
        {},
      );
      assert.ok(read.ok);
      assert.equal(read.value.remote?.key, REMOTE.key);
    }
    const unfound = commands.recordIdentity.handle(
      tx,
      machine,
      { project: PROJECT, found: false, repo: null, remote: null },
      {},
    );
    assert.ok(unfound.ok);
    assert.equal(unfound.value.repo, "git");
    assert.equal(unfound.value.identity, first.value.identity);
    assert.equal(unfound.value.revision, first.value.revision);
    const copy = loadProject(tx.sql, SECOND);
    assert.ok(copy.ok);
    assert.equal(copy.value?.identity, second.value.identity);

    const other = {
      ...PROJECT_IDENTITY_CONTEXT,
      principal: "machine:apps-source",
      credential_ref: "machine:apps-source",
    };
    for (const ctx of [user, other]) {
      const result = commands.recordIdentity.handle(
        tx,
        ctx,
        record(PROJECT, "none"),
        {},
      );
      assert.ok(!result.ok);
      assert.deepStrictEqual(result.error.code, "forbidden");
    }
    const loaded = loadProject(tx.sql, PROJECT);
    assert.ok(loaded.ok);
    assert.equal(loaded.value?.repo, "git");
  } finally {
    db.close();
  }
});

test("link_identity: git project의 identity는 바꾸지 못하고, 다른 project가 지금이나 옛 identity로 가진 id는 적지 못하며, 잇기와 나누기로 바뀐 identity는 project.list에 옛 identity로 남는다", () => {
  const { db, sql, tx, commands } = setup();
  const machine = PROJECT_IDENTITY_CONTEXT;
  try {
    const reason = (result: {
      ok: boolean;
      error?: { code: string; details?: Record<string, unknown> };
    }) =>
      result.ok
        ? "ok"
        : `${result.error?.code}:${result.error?.details?.reason}`;
    const born = new Map<string, string>();
    for (const [id, name] of [
      [PROJECT, "notes"],
      [SECOND, "plain"],
      [THIRD, "other"],
    ] as const) {
      const done = commands.register.handle(
        tx,
        user,
        input([{ path: `/srv/${name}`, description: "" }], id, name),
        {},
      );
      assert.ok(done.ok);
      born.set(id, done.value.identity);
    }
    assert.ok(
      commands.recordIdentity.handle(tx, machine, record(PROJECT), {}).ok,
    );
    assert.ok(
      commands.recordIdentity.handle(tx, machine, record(SECOND, "none"), {})
        .ok,
    );
    assert.ok(
      commands.recordIdentity.handle(tx, machine, record(THIRD, "none"), {}).ok,
    );

    // git project는 저장소로 맞춰진다.
    const git = commands.linkIdentity.handle(
      tx,
      user,
      { project: PROJECT, identity: LINKED },
      {},
    );
    assert.equal(reason(git), "conflict:git_project");

    const taken = commands.linkIdentity.handle(
      tx,
      user,
      { project: SECOND, identity: born.get(PROJECT)! },
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
    assert.equal(linked.value.revision, "1");

    // SECOND의 옛 identity도 그 project의 것이다.
    const former = commands.linkIdentity.handle(
      tx,
      user,
      { project: THIRD, identity: born.get(SECOND)! },
      {},
    );
    assert.equal(reason(former), "conflict:identity_in_use");

    // 다시 읽어도 적은 id가 남는다.
    const reread = commands.recordIdentity.handle(
      tx,
      machine,
      record(SECOND, "none"),
      {},
    );
    assert.ok(reread.ok);
    assert.equal(reread.value.identity, LINKED);

    // [Separate project]는 사람만 한다.
    const agent = { ...user, actor: "agent:agt_00000000000000000000000001" };
    assert.equal(
      reason(
        commands.renewIdentity.handle(tx, agent, { project: PROJECT }, {}),
      ),
      "forbidden:undefined",
    );
    assert.equal(
      reason(
        commands.linkIdentity.handle(
          tx,
          agent,
          { project: THIRD, identity: "pri_00000000000000000000000003" },
          {},
        ),
      ),
      "forbidden:undefined",
    );
    const renewed = commands.renewIdentity.handle(
      tx,
      user,
      { project: PROJECT },
      {},
    );
    assert.ok(renewed.ok);
    assert.notEqual(renewed.value.identity, born.get(PROJECT));

    const reads = createProjectReads({ folders: createFolderResolver() });
    const listed = reads.list.handle(
      { sql, as_of_seq: "1", port: tx.port } as never,
      user,
      {},
    );
    assert.ok(listed.ok);
    assert.deepStrictEqual(
      listed.value.projects
        .filter((project) => project.id !== THIRD)
        .map((project) => [
          project.id,
          project.identity,
          project.former_identities,
        ]),
      [
        [PROJECT, renewed.value.identity, [born.get(PROJECT)]],
        [SECOND, LINKED, [born.get(SECOND)]],
      ],
    );
  } finally {
    db.close();
  }
});
