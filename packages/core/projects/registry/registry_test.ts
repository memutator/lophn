import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
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
    [projectManagerProvisioningPort, {
      create: (_tx: Tx, project: string) => {
        managers.push(project);
        return ok(undefined);
      },
    }],
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

Deno.test("하위 폴더는 연결한 폴더 밖을 거절한다", () => {
  const { db, tx, commands } = setup();
  const root = Deno.makeTempDirSync();
  const outside = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(join(root, "docs"));
    Deno.symlinkSync(outside, join(root, "escape"));
    const register = (sub: string) =>
      commands.register.handle(
        tx,
        user,
        input([{
          path: root,
          description: "",
          subfolders: [{ path: sub, description: "" }],
        }]),
        {},
      );

    for (const sub of ["../x", "/etc", "escape", "missing"]) {
      const result = register(sub);
      assert(!result.ok, sub);
      assertEquals(result.error.code, "invalid_input", sub);
    }
    assertEquals(db.prepare("SELECT id FROM projects").all().length, 0);

    // 연결 폴더 안 하위 폴더는 받고, 나중에 밖으로 나가는 symlink로 고치는 것은 거절한다.
    const registered = register("docs");
    assert(registered.ok);
    assertEquals(registered.value.folders[0]!.subfolders[0]!.path, "docs");
    const edited = commands.edit.handle(
      tx,
      user,
      {
        project: PROJECT,
        folders: [{
          path: root,
          description: "",
          subfolders: [{ path: "escape", description: "" }],
        }],
      } as never,
      { base_revision: registered.value.revision },
    );
    assert(!edited.ok);
    assertEquals(edited.error.code, "invalid_input");
  } finally {
    db.close();
    Deno.removeSync(root, { recursive: true });
    Deno.removeSync(outside, { recursive: true });
  }
});

Deno.test("폴더 없이도 등록된다", () => {
  const { db, tx, managers, commands } = setup();
  try {
    const empty = commands.register.handle(tx, user, input([]), {});
    assert(empty.ok);
    assertEquals(empty.value.folders, []);
    assertEquals(managers, [PROJECT]);
  } finally {
    db.close();
  }
});

Deno.test("보관해도 폴더의 파일은 그대로다", () => {
  const { db, tx, managers, commands } = setup();
  const root = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(join(root, "note.md"), "hello");
    const registered = commands.register.handle(
      tx,
      user,
      input([{ path: root, description: "", subfolders: [] }]),
      {},
    );
    assert(registered.ok);
    assertEquals(managers, [PROJECT]);

    const archived = commands.archive.handle(
      tx,
      user,
      { project: PROJECT },
      { base_revision: registered.value.revision },
    );
    assert(archived.ok);
    assertEquals(archived.value.status, "archived");
    assertEquals(Deno.readTextFileSync(join(root, "note.md")), "hello");

    const back = commands.unarchive.handle(
      tx,
      user,
      { project: PROJECT },
      { base_revision: archived.value.revision },
    );
    assert(back.ok);
    assertEquals(back.value.status, "active");
    assertEquals(back.value.folders[0]!.found, true);
  } finally {
    db.close();
    Deno.removeSync(root, { recursive: true });
  }
});
