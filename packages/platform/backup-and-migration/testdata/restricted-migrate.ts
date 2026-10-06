// 권한을 제한한 프로세스(packaged core와 같은 모양)에서 복구본을 만들며 migration한다. 시험이 띄운다.
import { manualClock } from "../../../base/mod.ts";
import { applyMigrations } from "../mod.ts";

const root = Deno.args[0];
const clock = manualClock(Date.UTC(2026, 0, 1));
const first = [{
  id: "notes",
  sql: "create table notes (id integer primary key, body text not null)",
}];
const second = [
  ...first,
  { id: "notes-more", sql: "alter table notes add column revised text" },
];
const path = `${root}/lophn.db`;
const before = await applyMigrations(path, first, { clock });
if (!before.ok) {
  console.log(JSON.stringify(before.error));
  Deno.exit(2);
}
const migrated = await applyMigrations(path, second, {
  clock,
  recovery: { root },
});
console.log(JSON.stringify(migrated.ok ? { ok: true } : migrated.error));
Deno.exit(migrated.ok ? 0 : 1);
