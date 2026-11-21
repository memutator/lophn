# @lophn/declaration 5.0.0

Previous: 4.13.0
Breaking: yes. A new release whose `lophn.ts` still has `sync_to` is refused (`sync_to was replaced by sync`). A release already active with `sync_to` keeps running and syncing every table as before, until you release with `sync`. Move together with `@lophn/app-ui` 2.24.2 and, for phone screens, `@lophn/app-ui-native` 1.10.1.

`sync_to` (one destination for the whole app database) is replaced by `sync`: a map from table name to destination name. Only the listed tables leave this computer; every other table stays here. For now every listed table must name the same destination.

```ts
// lophn.ts, before
sync_to: "computers",
// after: today's behaviour is every table of the store, listed by name
sync: {
  notes: "computers",
  tags: "computers",
},
```

To keep exactly what the app does today, list every table the app's migrations create (not the `lophn_` tables). Then decide table by table, and remove what does not need to leave this computer:

- Keep a table when the person needs its rows on the other computers: what they write by hand, and small summaries other computers show.
- Remove a table that describes this computer or can be rebuilt here: raw records read from local files, file read positions, caches, large imports. Its rows stay on this computer; rows the other computers already received stay there.
- Rows each computer makes from its own source (an hourly rollup of this computer's records) must carry the computer's id in the primary key, for example `(machine, hour)`, read from `machines()` in `@lophn/cap-tool` (the entry with `current: true`). Without it two computers write the same key and overwrite each other's numbers column by column. Changing a primary key is a new table and a migration: create the new table, copy, and list the new one.

The schema rules for synced data now apply to the listed tables only (all tables for an app with `"phone"` in `runs_on`, whose phone copy keeps the whole store). Release preparation checks, with `invalid_input`-style reasons the agent can fix:

- every listed table exists after the migrations and has a primary key;
- on listed tables: no `INTEGER` primary key, no `AUTOINCREMENT`, no `UNIQUE` or `CHECK` outside the key, no trigger;
- a listed table does not reference a table that is not listed; a table that is not listed may reference a listed one, but not with `ON DELETE`/`ON UPDATE` `CASCADE`, `SET NULL` or `SET DEFAULT`.

A trigger on a table that is not listed may write to a listed table. `across_machines` events need `sync` to list at least one table. The 1 GiB limit counts the listed tables only.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.13.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.1",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/5.0.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.2",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Required of an existing app: nothing until its next release; that release must replace `sync_to` with `sync`. An app without `sync_to` needs no change. The first release with `sync` starts the app's data on the other computers from a fresh copy, as any new release does; tables removed from `sync` stop moving from then on.

## Instruction diff

The SDK guide replaced `sync_to` with `sync` and states which rules apply to listed tables; the `design-app` skill and its bundled file `folder-sync.md` now pick tables one by one and require the machine id in the key of per-computer rows; the app template's `AGENTS.md` paragraph changed. Make the lophn-managed part of this app's `AGENTS.md` match the new template lines below. From now on, list in `sync` only the tables that must leave this computer, and never send a raw per-computer table to share a small summary.

```diff
# @lophn/declaration guide.md
@@ -26 +26 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`, `sync_to`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`, `sync`만 있다. 알 수 없는 칸은 거절한다.
@@ -99 +99 @@
-    한 번 난다(발행 앱, 구독 handler, 화면, payload는 그 기계에서 낸 것과 같다). `sync_to`가 없는 선언에 쓰면 선언 오류다(event는
+    한 번 난다(발행 앱, 구독 handler, 화면, payload는 그 기계에서 낸 것과 같다). `sync`가 표를 하나도 보내지 않는 선언에 쓰면 선언 오류다(event는
@@ -133,2 +133,6 @@
-- `sync_to` — 이 앱의 data를 어느 destination으로 내보내는가. destination 이름 하나다. 소문자로 시작하고 소문자·숫자·`-`로
-  32자까지다. 칸이 없으면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다.
+- `sync` — 앱 DB의 어느 표를 어느 destination으로 보내는가. 표 이름 → destination 이름의 object다(`{ usage_hour: "computers",
+  plan: "computers" }`). 적은 표의 data만 그 destination으로 가고, 적지 않은 표는 이 컴퓨터를 떠나지 않는다. 칸이 없거나 비면
+  data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다. migration이 표를 더하면 보낼 것만 여기에 더한다.
+  - destination 이름은 소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 지금은 모든 표가 같은 destination이어야 한다(다르면 선언
+    오류다). 표 이름은 `lophn_`과 `sqlite_`로 시작하지 못한다. 적은 표가 앱 DB에 있는지와 PRIMARY KEY가 있는지는 release 준비가
+    target schema의 DB에서 본다.
@@ -141,3 +145,9 @@
-    변경은 `lophn`의 `data.changed`로 안다(`subscriptions`).
-  `sync_to`가 있는 앱은 컴퓨터에서 sync 앱이라 `runs_on`에 phone이 있는 앱과 같은 schema 규칙(text id, 정수 PK·
-  AUTOINCREMENT·trigger·PK 밖의 UNIQUE와 CHECK 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0 이상을 고정해야 한다.
+    변경은 `lophn`의 `data.changed`로 안다(`subscriptions`). `runs_on`에 phone이 있는 앱의 폰 사본은 `sync`와 상관없이 모든
+    표를 갖는다.
+  `sync`가 표를 보내는 앱은 컴퓨터에서 sync 앱이라 보내는 표에 `runs_on`에 phone이 있는 앱과 같은 schema 규칙(text id, 정수
+  PK·AUTOINCREMENT·PK 밖의 UNIQUE와 CHECK 없음, 그 표에 건 trigger 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0
+  이상을 고정해야 한다. 보내지 않는 표에는 이 규칙이 없다. 보내지 않는 표에 건 trigger는 보내는 표에 써도 된다. 보내는 표는
+  보내지 않는 표를 foreign key로 가리키지 못하고, 보내지 않는 표가 보내는 표를 가리킬 때는 `ON DELETE`·`ON UPDATE`의 `CASCADE`·
+  `SET NULL`·`SET DEFAULT`를 쓰지 못한다(다른 컴퓨터에서 온 변경은 그 동작을 돌리지 않는다). 컴퓨터마다 생기는 줄(그 컴퓨터의
+  원본에서 모은 집계)을 보내면 PRIMARY KEY에 그 컴퓨터의 id를 넣는다: 같은 key를 두 컴퓨터가 쓰면 칸마다 나중 것이 이겨
+  서로의 값을 덮는다.
# design-app SKILL.md
@@ -304 +304,2 @@ data also run on the phone (`runs_on`); `folder-sync.md` when its data must
-reach the person's other computers (`sync_to`, `"computers"` first; changes
+reach the person's other computers (`sync`, only the tables that must leave,
+`"computers"` first; changes
# design-app folder-sync.md (main hunks)
@@ -43,7 +45 @@
-The limits of `sync_to` come before the choice. Today it moves the whole app
-database, not a table: the store must stay well under 1 GiB, with no triggers,
-text primary keys (no `AUTOINCREMENT`), and no `UNIQUE` or `CHECK` outside the key
-(the full list is in "What syncing asks of the app"). An app with a large
-per-computer table must not turn `sync_to` on to share a small summary: read the
-other computers' summaries with `connectCommands(…, { on })`, and cache the small
-result locally if the screen must show it while that computer is off.
+## Pick the tables and the destination
@@ -65 +59,7 @@
-3. Decide per app, not once for the person:
+3. Decide per table, not once for the app:
+   - List a table when the person needs its rows on the other computers: what they
+     write by hand (notes, plans, settings of the app they expect everywhere) and
+     small summaries the other computers show.
+   - Leave a table out when it describes this computer or can be rebuilt here: raw
+     records read from local files, file read positions, caches, large imports.
+     Leaving out a large raw table is what keeps the synced data small.
@@ -69,3 +69,2 @@
-   - Every table of the app's store goes to the destination. State that belongs to
-     one machine (window layout, a local path, the last opened file) does not go in
-     the store: keep it in `localStorage`.
+   - State that belongs to one machine (window layout, a local path, the last
+     opened file) does not go in the store at all: keep it in `localStorage`.
@@ -85,4 +97,6 @@
-An app with `sync_to` is a sync app on the computer: every computer that has the
-app writes rows and the copies are merged per column. Follow the "Data" section of
-`phone-apps.md`; release preparation refuses an app that breaks the first two
-rules:
+An app whose `sync` lists a table is a sync app on the computer: every computer
+that has the app writes rows to the listed tables and the copies are merged per
+column. The rules below apply to the listed tables only (for a `runs_on` phone app,
+to every table, because the phone keeps the whole store). Follow the "Data"
+section of `phone-apps.md`; release preparation refuses an app that breaks the
+first three rules:
@@ -101,0 +124,5 @@ Know and design for these:
+- Rows that each computer makes from its own source (an hourly rollup of this
+  computer's records) must carry the computer's id in the primary key, for example
+  `(machine, hour)`. Read the id from `machines()` (`@lophn/cap-tool`, the entry
+  with `current: true`). Without it, two computers write the same key and each
+  overwrites the other's numbers column by column.
# app template AGENTS.md.tmpl
@@ -77,2 +77,3 @@
-  `sync_to`는 앱의 data를 사람의 다른 컴퓨터로 보낼 destination 이름이다. 없으면 data는 이 기계에만 있다. 먼저 `"computers"`를
-  고른다(옮기는 길은 lophn이 고른다). 다른 기계와 폰에서 온 변경은 `lophn`의 event `data.changed`로 안다.
+  `sync`는 앱 DB의 어느 표를 사람의 다른 컴퓨터로 보낼지다(표 이름 → destination 이름). 적지 않은 표는 이 기계에만 있다.
+  보낼 표만 적고, destination은 먼저 `"computers"`를 고른다(옮기는 길은 lophn이 고른다). 다른 기계와 폰에서 온 변경은
+  `lophn`의 event `data.changed`로 안다.
```
