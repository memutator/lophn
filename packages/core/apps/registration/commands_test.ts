import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { createAppCommands } from "./commands.ts";
import { appProjectLookupPort } from "./ports.ts";
import { appsSchemaSteps } from "./schema.ts";

const PROJECT = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const GONE = "prj_01hzzzzzzzzzzzzzzzzzzzzzzc";
const ARCHIVED = "prj_01hzzzzzzzzzzzzzzzzzzzzzzd";
const USER: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  let count = 0;
  const projects: Record<string, { status: "active" | "archived" }> = {
    [PROJECT]: { status: "active" },
    [OTHER]: { status: "active" },
    [ARCHIVED]: { status: "archived" },
  };
  const ports = new Map<unknown, unknown>([
    [appProjectLookupPort, { get: (id: string) => projects[id] ?? null }],
    [TargetAuthorization, () => ok(undefined)],
  ]);
  const tx = {
    sql: {
      run: (text: string, params: never[]) => {
        const done = db.prepare(text).run(...params);
        return { changes: done.changes, lastInsertRowid: done.lastInsertRowid };
      },
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    newId: (prefix: string) =>
      `${prefix}_01h${String(++count).padStart(23, "z")}`,
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const create = createAppCommands().create;
  return (slug: string, project: string) =>
    (create.handle as (...a: unknown[]) => { ok: boolean; error?: never })(
      tx,
      USER,
      { slug, project, name: slug, description: "does things" },
      {},
    ) as { ok: boolean; error?: { code: string } };
}

Deno.test("같은 project에 앱을 두 번 만들면 conflict다", () => {
  const create = open();
  assertEquals(create("first", PROJECT).ok, true);
  const second = create("second", PROJECT);
  assertEquals(second.error?.code, "conflict");
  assertEquals(create("third", OTHER).ok, true);
});

Deno.test("없는 project나 보관한 project로는 앱을 못 만든다", () => {
  const create = open();
  assertEquals(create("first", GONE).error?.code, "not_found");
  assertEquals(create("second", ARCHIVED).error?.code, "conflict");
});
