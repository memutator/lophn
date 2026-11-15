import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneSchemaProblems, type PhoneSchemaTable } from "./phone-schema.ts";

const table = (
  name: string,
  columns: PhoneSchemaTable["columns"],
  sql = `CREATE TABLE ${name} (...)`,
  indexes: PhoneSchemaTable["indexes"] = [],
): PhoneSchemaTable => ({ name, columns, sql, indexes });

test("폰 schema 검사는 column 하나짜리 INTEGER PK, AUTOINCREMENT, trigger를 거절하고 text PK와 여러 column PK는 통과시킨다", () => {
  assert.deepEqual(
    phoneSchemaProblems(
      [
        table("note", [{ name: "id", type: "TEXT", pk: 1 }]),
        table("link", [
          { name: "a", type: "INTEGER", pk: 1 },
          { name: "b", type: "INTEGER", pk: 2 },
        ]),
      ],
      [],
    ),
    [],
  );
  const integer = phoneSchemaProblems(
    [table("item", [{ name: "id", type: "integer", pk: 1 }])],
    [],
  );
  assert.equal(integer.length, 1);
  assert.match(integer[0], /Table item has an INTEGER primary key/);
  const auto = phoneSchemaProblems(
    [
      table(
        "log",
        [{ name: "id", type: "TEXT", pk: 1 }],
        "CREATE TABLE log (id TEXT PRIMARY KEY, n INTEGER AUTOINCREMENT)",
      ),
    ],
    [],
  );
  assert.match(auto.join(" "), /Table log uses AUTOINCREMENT/);
  const unique = phoneSchemaProblems(
    [
      table("user", [{ name: "id", type: "TEXT", pk: 1 }], undefined, [
        { name: "sqlite_autoindex_user_1", unique: true, origin: "pk" },
        { name: "user_email", unique: true, origin: "u" },
        { name: "user_name", unique: false, origin: "c" },
      ]),
    ],
    [],
  );
  assert.equal(unique.length, 1);
  assert.match(unique[0], /UNIQUE constraint or unique index \(user_email\)/);
  const check = phoneSchemaProblems(
    [
      table(
        "stock",
        [{ name: "id", type: "TEXT", pk: 1 }],
        "CREATE TABLE stock (id TEXT PRIMARY KEY, n INTEGER NOT NULL CHECK (n >= 0))",
      ),
    ],
    [],
  );
  assert.match(check.join(" "), /Table stock has a CHECK constraint/);
  const trigger = phoneSchemaProblems([], ["item_after_insert"]);
  assert.match(
    trigger.join(" "),
    /Triggers are not allowed.*item_after_insert/,
  );
});
