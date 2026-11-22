import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/environment.ts";
import { createCoreRegistration } from "./lophn-agent-registration.ts";

createCoreRegistration();

const MAHAS = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

function appsOf(rows: readonly [string, string, string][]) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "create table apps (id text, slug text, name text, description text, status text, source_path text)",
  );
  for (const [id, slug, name] of rows) {
    db.prepare("insert into apps values (?, ?, ?, '', 'active', null)").run(
      id,
      slug,
      name,
    );
  }
  const sql = {
    get: (query: string, params: readonly unknown[] = []) =>
      db.prepare(query).get(...(params as never[])) as never,
    all: (query: string, params: readonly unknown[] = []) =>
      db.prepare(query).all(...(params as never[])) as never,
  };
  return workspaceDepsOf(sql as never).apps;
}

// 이름을 바꿔 표시 이름이 겹치면 call·job·run이 아무 앱으로나 가서 다른 앱의 code를 고치게 된다.
test("앱 주소는 id·slug를 먼저 보고, 여러 앱에 걸린 표시 이름은 invalid_input이다", () => {
  const apps = appsOf([
    [MAHAS, "mahas", "Notes"],
    [OTHER, "notes", "Notes"],
  ]);
  const bySlug = apps.appByName("notes");
  assert.equal(bySlug.ok && bySlug.value.id, OTHER);
  const byId = apps.appByName(MAHAS);
  assert.equal(byId.ok && byId.value.id, MAHAS);
  const byName = apps.appByName("Notes");
  assert.equal(byName.ok, false);
  assert.equal(!byName.ok && byName.error.code, "invalid_input");
  const missing = apps.appByName("gone");
  assert.equal(!missing.ok && missing.error.code, "not_found");
});
