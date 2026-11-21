// 다른 사본과 맞추는 앱 DB의 schema 규칙이다. 폰과 컴퓨터, 컴퓨터끼리 같은 표를 각자 바꿔 changeset으로 합치므로, 두
// 쪽이 만든 행의 키가 겹치거나 합치기가 못 보는 변경이 생기는 모양을 막는다. 규칙은 맞추는 표에만 건다: 폰 앱은 모든
// 표, 그 밖에는 선언의 `sync`가 보내는 표다. 순수 함수라 zod도 DB도 모른다.

export type PhoneSchemaTable = {
  name: string;
  // `pragma table_info`의 한 줄이다. pk는 PRIMARY KEY 안의 순서(0이면 key가 아니다).
  columns: { name: string; type: string; pk: number }[];
  // sqlite_master의 CREATE TABLE 문이다.
  sql: string;
  // `pragma index_list`의 한 줄이다. origin은 'c'(CREATE INDEX), 'u'(UNIQUE 제약), 'pk'(PRIMARY KEY)다.
  indexes: { name: string; unique: boolean; origin: string }[];
  // `pragma foreign_key_list`의 한 줄이다. table은 가리키는 표, on_delete·on_update는 그 동작(`NO ACTION`, `CASCADE` 등)이다.
  foreignKeys: { table: string; on_delete: string; on_update: string }[];
};

// trigger와 그 trigger가 걸린 표(sqlite_master의 tbl_name).
export type SchemaTrigger = { name: string; table: string };

// 받은 변경과 합치기는 foreign_keys를 끄고 적용해 이 동작이 돌지 않는다. 이 기계에서만 돌면 사본이 갈린다.
const FOLLOWING_ACTIONS = new Set(["CASCADE", "SET NULL", "SET DEFAULT"]);

/**
 * 영어 문장 목록이다. 비어 있으면 통과한다. agent가 읽고 고친다. `synced`는 다른 사본과 맞추는 표이고 null이면 모든
 * 표다(폰 앱). `listed`는 선언의 `sync`가 적은 표다: 있어야 하고 PRIMARY KEY가 있어야 한다.
 */
export function phoneSchemaProblems(
  tables: readonly PhoneSchemaTable[],
  triggers: readonly SchemaTrigger[],
  synced: ((table: string) => boolean) | null = null,
  listed: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const isSynced = (table: string) => synced === null || synced(table);
  const byName = new Map(tables.map((table) => [table.name, table]));
  for (const name of listed) {
    const table = byName.get(name);
    if (table === undefined) {
      problems.push(
        `sync lists table ${name}, but the migrations do not create it. List only tables the app's store has.`,
      );
    } else if (!table.columns.some((column) => column.pk > 0)) {
      problems.push(
        `Table ${name} is listed in sync but has no PRIMARY KEY. Changes to it cannot be recorded; give it a text primary key made with newId().`,
      );
    }
  }
  for (const table of tables) {
    if (!isSynced(table.name)) continue;
    const key = table.columns.filter((column) => column.pk > 0);
    if (key.length === 1 && key[0].type.trim().toUpperCase() === "INTEGER") {
      problems.push(
        `Table ${table.name} has an INTEGER primary key (${key[0].name}). Two copies both insert rows, so integer ids collide; use a text primary key made with newId().`,
      );
    }
    for (const index of table.indexes) {
      if (index.unique && index.origin !== "pk") {
        problems.push(
          `Table ${table.name} has a UNIQUE constraint or unique index (${index.name}). Two copies can insert the same value and the merge then fails on every retry; enforce it in the handler, or make the value part of the primary key.`,
        );
      }
    }
    if (/\bCHECK\s*\(/i.test(table.sql)) {
      problems.push(
        `Table ${table.name} has a CHECK constraint. Columns of one row can come from two copies and fail it together, so the merge fails on every retry; check the value in the handler instead.`,
      );
    }
    if (/\bAUTOINCREMENT\b/i.test(table.sql)) {
      problems.push(
        `Table ${table.name} uses AUTOINCREMENT. Counters on two copies would collide; use a text primary key made with newId().`,
      );
    }
  }
  const firing = triggers.filter((trigger) => isSynced(trigger.table));
  if (firing.length > 0) {
    problems.push(
      `Triggers are not allowed on a table that syncs (${firing.map((trigger) => trigger.name).join(", ")}). Changes from another copy apply to that table and fire the trigger again, so its work happens twice; do that work in the handler. A trigger on a table that stays on this computer may write to a table that syncs.`,
    );
  }
  if (synced === null) return problems;
  for (const table of tables) {
    for (const foreign of table.foreignKeys) {
      if (isSynced(table.name) && !isSynced(foreign.table)) {
        problems.push(
          `Table ${table.name} syncs but references ${foreign.table}, which stays on this computer. Other computers have no such parent row; list ${foreign.table} in sync too, or drop the reference.`,
        );
      } else if (
        !isSynced(table.name) &&
        isSynced(foreign.table) &&
        (FOLLOWING_ACTIONS.has(foreign.on_delete.toUpperCase()) ||
          FOLLOWING_ACTIONS.has(foreign.on_update.toUpperCase()))
      ) {
        problems.push(
          `Table ${table.name} references ${foreign.table}, which syncs, with ON DELETE or ON UPDATE CASCADE, SET NULL or SET DEFAULT. Changes from another computer do not run that action, so the two copies drift; handle it in the handler instead.`,
        );
      }
    }
  }
  return problems;
}
