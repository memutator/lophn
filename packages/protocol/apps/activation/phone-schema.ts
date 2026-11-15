// 폰에서 도는 backend의 DB schema 규칙이다. 폰과 컴퓨터가 같은 DB를 각자 바꿔 changeset으로 합치므로, 두 쪽이
// 만든 행의 키가 겹치거나 합치기가 못 보는 변경이 생기는 모양을 막는다. 순수 함수라 zod도 DB도 모른다.

export type PhoneSchemaTable = {
  name: string;
  // `pragma table_info`의 한 줄이다. pk는 PRIMARY KEY 안의 순서(0이면 key가 아니다).
  columns: { name: string; type: string; pk: number }[];
  // sqlite_master의 CREATE TABLE 문이다.
  sql: string;
  // `pragma index_list`의 한 줄이다. origin은 'c'(CREATE INDEX), 'u'(UNIQUE 제약), 'pk'(PRIMARY KEY)다.
  indexes: { name: string; unique: boolean; origin: string }[];
};

// 영어 문장 목록이다. 비어 있으면 통과한다. agent가 읽고 고친다.
export function phoneSchemaProblems(
  tables: readonly PhoneSchemaTable[],
  triggers: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const table of tables) {
    const key = table.columns.filter((column) => column.pk > 0);
    if (key.length === 1 && key[0].type.trim().toUpperCase() === "INTEGER") {
      problems.push(
        `Table ${table.name} has an INTEGER primary key (${key[0].name}). The phone and the computer both insert rows, so integer ids collide; use a text primary key made with newId().`,
      );
    }
    for (const index of table.indexes) {
      if (index.unique && index.origin !== "pk") {
        problems.push(
          `Table ${table.name} has a UNIQUE constraint or unique index (${index.name}). Two devices can insert the same value and the merge then fails on every retry; enforce it in the handler, or make the value part of the primary key.`,
        );
      }
    }
    if (/\bCHECK\s*\(/i.test(table.sql)) {
      problems.push(
        `Table ${table.name} has a CHECK constraint. Columns of one row can come from two devices and fail it together, so the merge fails on every retry; check the value in the handler instead.`,
      );
    }
    if (/\bAUTOINCREMENT\b/i.test(table.sql)) {
      problems.push(
        `Table ${table.name} uses AUTOINCREMENT. Counters on the phone and the computer would collide; use a text primary key made with newId().`,
      );
    }
  }
  if (triggers.length > 0) {
    problems.push(
      `Triggers are not allowed in a phone backend (${triggers.join(", ")}). A trigger changes rows outside the recorded changes, so the phone and the computer drift apart; do that work in the handler.`,
    );
  }
  return problems;
}
