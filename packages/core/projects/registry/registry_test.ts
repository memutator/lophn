import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import { TargetAuthorization } from "../../../protocol/server/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createProjectCommands } from "./commands.ts";
import { createFolderResolver } from "./folder-resolver.ts";
import { folderResolverPort, projectManagerProvisioningPort } from "./ports.ts";
import { projectsSchemaSteps } from "./schema.ts";

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
  for (const step of projectsSchemaSteps) db.exec(step.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const managers: string[] = [];
  const resolver = createFolderResolver();
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [folderResolverPort, resolver],
    [
      projectManagerProvisioningPort,
      {
        create: (_tx: Tx, project: string) => {
          managers.push(project);
          return ok(undefined);
        },
      },
    ],
  ]);
  const tx = {
    sql,
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  return { db, sql, tx, managers, commands: createProjectCommands() };
}

const PROJECT = "prj_00000000000000000000000001";

function input(folders: unknown) {
  return {
    id: PROJECT,
    name: "notes",
    title: "Notes",
    purpose: "keep notes",
    folders,
  } as never;
}

test("하위 폴더는 연결한 폴더 밖을 거절한다", () => {
  const { db, tx, commands } = setup();
  const root = mkdtempSync(join(tmpdir(), "lophn-registry-"));
  const outside = mkdtempSync(join(tmpdir(), "lophn-registry-"));
  try {
    mkdirSync(join(root, "docs"));
    symlinkSync(outside, join(root, "escape"));
    const register = (sub: string) =>
      commands.register.handle(
        tx,
        user,
        input([
          {
            path: root,
            description: "",
            subfolders: [{ path: sub, description: "" }],
          },
        ]),
        {},
      );

    for (const sub of ["../x", "/etc", "escape", "missing"]) {
      const result = register(sub);
      assert.ok(!result.ok, sub);
      assert.deepStrictEqual(result.error.code, "invalid_input", sub);
    }
    assert.deepStrictEqual(
      db.prepare("SELECT id FROM projects").all().length,
      0,
    );

    // 연결 폴더 안 하위 폴더는 받고, 나중에 밖으로 나가는 symlink로 고치는 것은 거절한다.
    const registered = register("docs");
    assert.ok(registered.ok);
    assert.deepStrictEqual(
      registered.value.folders[0]!.subfolders[0]!.path,
      "docs",
    );
    const edited = commands.edit.handle(
      tx,
      user,
      {
        project: PROJECT,
        folders: [
          {
            path: root,
            description: "",
            subfolders: [{ path: "escape", description: "" }],
          },
        ],
      } as never,
      { base_revision: registered.value.revision },
    );
    assert.ok(!edited.ok);
    assert.deepStrictEqual(edited.error.code, "invalid_input");
  } finally {
    db.close();
    rmSync(root, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});

test("폴더 없이도 등록된다", () => {
  const { db, tx, managers, commands } = setup();
  try {
    const empty = commands.register.handle(tx, user, input([]), {});
    assert.ok(empty.ok);
    assert.deepStrictEqual(empty.value.folders, []);
    assert.deepStrictEqual(managers, [PROJECT]);
  } finally {
    db.close();
  }
});

test("보관해도 폴더의 파일은 그대로다", () => {
  const { db, tx, managers, commands } = setup();
  const root = mkdtempSync(join(tmpdir(), "lophn-registry-"));
  try {
    writeFileSync(join(root, "note.md"), "hello");
    const registered = commands.register.handle(
      tx,
      user,
      input([{ path: root, description: "", subfolders: [] }]),
      {},
    );
    assert.ok(registered.ok);
    assert.deepStrictEqual(managers, [PROJECT]);

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
