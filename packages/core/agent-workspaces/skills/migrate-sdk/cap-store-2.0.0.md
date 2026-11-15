# @lophn/cap-store 2.0.0

Previous: 1.0.0
Breaking: yes. `store.db` is no longer the Node `DatabaseSync` but a smaller `StoreDb` (`exec` and `prepare(sql).get/all/run`, positional params only). Code that calls Node-only methods or uses named params stops type-checking. A release sealed with 1.0.0 keeps starting and running as it is.

`store.db` is now `StoreDb`, the part of SQLite every place that runs your backend can give (the computer today, the phone later). `store.migrate()` with no arguments applies the release's `migrations/*.sql`, `store.transaction` can nest, and `newId(prefix?)` makes ids that do not collide across devices.

Before:

```ts
import { readFileSync } from "node:fs";
import { migrationOfSql, openStore } from "@lophn/cap-store";

const store = openStore();
const step = migrationOfSql(0, 1, readFileSync("migrations/0-1.sql", "utf8"));
if (step.ok) await store.migrate([step.value], { target: 1 });
store.db.prepare("insert into item (name, qty) values (@name, @qty)").run({ name: "milk", qty: 2 });
store.db.exec("begin");
// ...
store.db.exec("commit");
```

After:

```ts
import { newId, openStore } from "@lophn/cap-store";

const store = openStore();
await store.migrate(); // applies migrations/<from>-<to>.sql, no file reading
store.transaction((db) => {
  // text primary key + newId(): ids do not collide across devices
  db.prepare("insert into item (id, name, qty) values (?, ?, ?)").run(newId("itm"), "milk", 2);
});
```

- Named params (`@name`, `:name`, `$name`) and object arguments to `run/get/all` are gone. Pass positional `?` params. Allowed values: `null | number | bigint | string | Uint8Array`.
- Node-only methods on `store.db` (`backup`, `function`, `loadExtension`, `createSession`, `isTransaction`, ...) are not in `StoreDb`. Do the work in SQL, or in a script outside the app process.
- Do not write `BEGIN`/`COMMIT`/`ROLLBACK` as SQL. Use `store.transaction(work)`; it is a SAVEPOINT, so it nests and works when the call already runs inside a transaction (it does on the phone and for sync apps). `work` must be synchronous.
- `store.migrate()` with no arguments replaces reading `migrations/` yourself. `store.migrate(steps, { target? })` still works. In an app test (no lophn host) `migrate()` reads `migrations/*.sql` from the current folder.
- `newId(prefix?)` returns a lowercase ULID-shaped text id (`prefix_01j...`) that sorts by creation time. Prefer `text primary key` with `newId()` over `integer primary key` for tables that more than one device writes.

Change the same version in `package.json` (`file:.lophn/sdk/cap-store/2.0.0`) and in `lophn.ts` (`sdk_dependencies`). If the app only calls `prepare(...).run/get/all` with positional params and `exec`, nothing else is required; run the app's type check to find the rest.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- Read and write through `StoreDb` only, with positional params. Do not call Node-only methods.
- Call `await store.migrate()` to bring the schema up to date; do not read migration files in app code.
- Use `store.transaction`, never `BEGIN`/`COMMIT` as SQL.
- Use `newId()` text ids for primary keys of tables that two devices may write.

```diff
# @lophn/cap-store guide.md
@@ -16,7 +16,15 @@ import { openStore } from "@lophn/cap-store";
   `Store`를 돌려준다. 앱 data는 앱 DB 하나라서 process 안의 연결도 하나이고,
-  `openStore`를 다시 불러도 같은 연결이다.
-- `store.db` — 앱 자신의 `node:sqlite` `DatabaseSync`. SQL은 앱이 쓴다.
+  `openStore`를 다시 불러도 같은 연결이다. 앱이 폰에서 돌 때는 host가 DB를 열어 준다.
+- `store.db` — 앱 자신의 DB(`StoreDb`)다. SQL은 앱이 쓴다. `exec(sql)`과
+  `prepare(sql)`의 `get(...params)`, `all(...params)`, `run(...params)`만 있다.
+  params는 `null | number | bigint | string | Uint8Array`를 위치 순서로 넘긴다
+  (`@name` 같은 이름 붙인 params와 Node 전용 method는 없다. 앱이 폰에서도 도는 길이
+  막히지 않게 하려는 것이다). `run`은 `{ changes, lastInsertRowid }`를 돌려준다.
 - `store.schema()` — 지금 schema 번호. migration을 적용한 적이 없으면 0이다.
+- `store.migrate()` — release의 `migrations/<from>-<to>.sql`을 현재 schema에서
+  최신까지 적용한다. 앱의 schema를 맞추는 보통의 길이다. 파일을 직접 읽지 않는다.
+  lophn이 돌릴 때는 lophn이 단계를 주고, 앱 test는 앱 폴더(지금 폴더)의
+  `migrations/*.sql`을 읽는다.
 - `store.migrate(steps, { target? })` — `{ from, to, sql, loss }`
-  단계(`Migration`)를 현재 schema에서 target까지 연속 경로로 적용한다. 단계마다
+  단계(`Migration`)를 직접 줄 때다. 현재 schema에서 target까지 연속 경로로 적용한다. 단계마다
   한 transaction이고 실패한 단계는 rollback한다. 단계에서 새로 만든 표에 PRIMARY
@@ -31,3 +39,8 @@ import { openStore } from "@lophn/cap-store";
   `-- loss: narrow_type 표.열` 줄이 손실 선언이다.
-- `store.transaction(work)` — 동기 작업 하나를 한 transaction으로 묶는다.
+- `store.transaction(work)` — 동기 작업 하나를 한 transaction으로 묶는다. 던지면
+  이 작업만 rollback한다. 겹쳐 불러도 된다. SQL로 `BEGIN`/`COMMIT`을 직접 쓰지
+  않는다: 폰과 sync 앱에서는 호출 하나가 이미 transaction 안에서 돈다.
+- `newId(prefix?)` — 기기가 달라도 겹치지 않는 text id다(ULID 꼴이라 만든 시각
+  순으로 정렬된다). 두 기기에서 쓰는 앱의 표는 `integer primary key`의 자동
+  번호 대신 `text primary key`에 이 id를 넣는다.
 - write·external tool과 앱 시작이 도는 동안의 변경은 runtime이 SDK 훅으로
@@ -36,3 +49,3 @@ import { openStore } from "@lophn/cap-store";
 - DB를 열지 못하면 `CapabilityError`(`unavailable`)다.
-- type: `Store`, `Migration`, `OpenStoreOptions`, `CapabilityError`
+- type: `Store`, `StoreDb`, `StoreStatement`, `Migration`, `OpenStoreOptions`, `CapabilityError`
 
@@ -49,6 +62,12 @@ import { openStore } from "@lophn/cap-store";
 ```ts
-import { openStore } from "@lophn/cap-store";
+import { newId, openStore } from "@lophn/cap-store";
 
 const store = openStore();
-store.db.prepare("insert into todo (title) values (?)").run("우유 사기");
+await store.migrate();
+store.transaction((db) => {
+  db.prepare("insert into todo (id, title) values (?, ?)").run(
+    newId("tdo"),
+    "우유 사기",
+  );
+});
 ```
```
