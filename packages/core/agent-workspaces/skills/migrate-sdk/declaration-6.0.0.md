# @lophn/declaration 6.0.0

Previous: 5.2.0
Breaking: yes. Default data sync changes from local-only to `"computers"` for every table not opted out with `"local"`. Existing sealed 5.x releases keep running as before; upgrading an app to 6.0.0 opts its tables into `"computers"` sync unless opted out. Move together with `@lophn/app-ui` 2.26.0 or `@lophn/app-ui-native` 1.12.0 (they depend on this exact version).

In `@lophn/declaration` 6.0.0, omitting `sync` on a computer app syncs all app tables to `"computers"` by default. Use `sync: "local"` to keep an entire app on one computer, or set per-table entries to `"local"` for device-local cache tables. Per-table entries can also be `{ destination?, conflict?: "lww" | "keep_both" }` so concurrent text edits on two devices keep both versions (winner on the original primary key, loser text preserved on a deterministic conflict-copy row) instead of dropping the older text under LWW.

```ts
// lophn.ts, before (5.2.0): only listed tables synced; omitted tables stayed local
sync: {
  notes: "computers",
},

// after (6.0.0): unlisted tables default to "computers"; opt out cache tables with "local"
// and use conflict: "keep_both" on free-form text tables
sync: {
  cache: "local",
  notes: { conflict: "keep_both" },
  archive: "personal",
},

// or keep an entire app on one computer
sync: "local",
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/5.2.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/6.0.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). If an existing app relies on tables staying local (for example, tables with integer primary keys, UNIQUE/CHECK constraints, or triggers), add `sync: "local"` or mark those tables `"local"` before releasing on 6.0.0 so release preparation accepts the schema. `across_machines: true` events are now allowed when `sync` is omitted on 6.0.0 (and still rejected when `sync: "local"`).

## Instruction diff

Update the app's sync model in `lophn.ts` and `DESIGN.md` to reflect that tables sync to `"computers"` by default in 6.0.0: explicitly opt out device-local tables with `"local"`, and choose `conflict: "keep_both"` for prose/note text tables where concurrent edits should keep both versions.

```diff
diff --git a/packages/sdk/declaration/guide.md b/packages/sdk/declaration/guide.md
index ef351c57c..c3a56654b 100644
--- a/packages/sdk/declaration/guide.md
+++ b/packages/sdk/declaration/guide.md
@@ -18,7 +18,7 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
 - `canonicalInputHash(schema, value)` — 정규 입력 hash를 낸다.
 - type: `AppDeclaration`, `ScreenDeclaration`, `OperationDeclaration`,
   `CommandDeclaration`, `Place`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
-  `SkillDeclaration`, `AppKeyDeclaration`, `EventDeclaration`, `SubscriptionDeclaration`, `WidgetDeclaration`, `RunsOn`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
+  `SkillDeclaration`, `AppKeyDeclaration`, `EventDeclaration`, `SubscriptionDeclaration`, `WidgetDeclaration`, `RunsOn`, `SyncConflictStrategy`, `SyncTablePolicy`, `SyncDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
 
 ## 선언의 칸
 
@@ -96,8 +96,9 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     그래서 event만으로 상태를 만들지 말고, 발행 앱은 지금 값을 읽는 read command를 따로 내놓는다. 구독 앱은 켜질 때 그 command를
     한 번 읽는다.
   - `across_machines: true`면 그 event가 앱의 data와 같은 길로 사람의 다른 기계에도 가서, 그 앱이 같은 release로 있는 기계마다
-    한 번 난다(발행 앱, 구독 handler, 화면, payload는 그 기계에서 낸 것과 같다). `sync`가 표를 하나도 보내지 않는 선언에 쓰면 선언 오류다(event는
-    data와 같이 간다). 칸이 없거나 false면 이 기계에서만 나고, 칸이 없는 옛 선언의 hash는 그대로다. data처럼 늦게 닿을 수 있고
+    한 번 난다(발행 앱, 구독 handler, 화면, payload는 그 기계에서 낸 것과 같다). `@lophn/declaration` 6.0.0 이상에서는 `sync: "local"`이
+    아닌 한 기본 `"computers"`로 동기화되므로 그대로 쓸 수 있고, `sync: "local"`(또는 5.x에서 `sync`가 비어 표를 하나도 보내지 않는 선언)에 쓰면
+    선언 오류다(event는 data와 같이 간다). 칸이 없거나 false면 이 기계에서만 나고, 칸이 없는 옛 선언의 hash는 그대로다. data처럼 늦게 닿을 수 있고
     7일보다 옛 event는 내지 않는다. 사람이 이 앱 workspace를 private으로 둔 기계에서는 그 기계가 낸 event가 다른 기계로 가지
     않고, 다른 기계에서 온 event도 그 기계에서 나지 않는다. 다른 기계에서 온 data의 변경은 이 칸 없이 `data.changed`로 안다.
@@ -130,13 +131,16 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   폰에서 도는 backend는 text id(`newId()`)를 쓰고, `node:` import·trigger·정수 PK·PK 밖의 UNIQUE와 CHECK를 쓰지 못하며
   (release 준비가 거절한다), 컴퓨터 전용 일(network, secret, 알림, event 발행, agent)은 `external` operation에 둔다.
   `external`은 컴퓨터에 닿지 않으면 `unavailable`이다. 규칙 전부는 `design-app` skill의 bundled file `phone-apps.md`("Apps that run on the phone")다.
-- `sync` — 앱 DB의 어느 표를 어느 destination으로 보내는가. 표 이름 → destination 이름의 object다(`{ usage_hour: "computers",
-  plan: "computers", session_archive: "personal" }`). 적은 표의 data만 그 destination으로 가고, 적지 않은 표는 이 컴퓨터를
-  떠나지 않는다. 칸이 없거나 비면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다. migration이 표를 더하면 보낼 것만
-  여기에 더한다.
+- `sync` — 앱 DB 표의 동기화 범위와 충돌 전략이다. `@lophn/declaration` 6.0.0부터는 **`sync`를 적지 않아도 컴퓨터 앱의 모든 표가
+  기본 `"computers"`(내 컴퓨터들)로 동기화**된다. 이 컴퓨터에만 둘 표(기기 cache 등)만 `"local"`로 빼고, 앱 전체를 이 컴퓨터 전용으로
+  두려면 `sync: "local"`로 둔다.
+  - 표별 설정은 `"local"`, destination 이름(`"computers"`·`"personal"` 등), 또는 `{ destination?, conflict? }` object다
+    (`{ cache: "local", notes: { conflict: "keep_both" }, session_archive: "personal" }`). `destination`을 빼면 기본 `"computers"`다.
+    `conflict`는 `"lww"`(기본, 칸 단위 나중 값) 또는 `"keep_both"`(동시 텍스트 수정 때 승자 row는 원래 PK로 유지하고 패자 텍스트는
+    결정론적 사본 PK row로 함께 남김)다. `"local"` 표에는 `conflict`를 둘 수 없다.
   - destination 이름은 소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 표마다 다른 destination이어도 된다. destination마다
     따로 내보내고 읽어 하나가 막혀도 다른 것은 돌고, 다른 컴퓨터는 자기에게 있는 destination의 표만 받는다. `runs_on`에
-    `phone`이 있는 앱은 모든 표가 같은 destination이어야 한다(다르면 선언 오류다). 표 이름은 `lophn_`과 `sqlite_`로
+    `phone`이 있는 앱은 모든 동기화 표가 같은 destination이어야 한다(다르면 선언 오류다). 표 이름은 `lophn_`과 `sqlite_`로
     시작하지 못한다. 적은 표가 앱 DB에 있는지와 PRIMARY KEY가 있는지는 release 준비가 target schema의 DB에서 본다.
@@ -146,14 +150,13 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   - `["phone"]`인 앱은 쓰지 못한다(폰의 data는 컴퓨터를 거쳐서만 나가는데 그 앱은 컴퓨터 사본이 없다). 다른 기계와 폰에서 온
     변경은 `lophn`의 `data.changed`로 안다(`subscriptions`). `runs_on`에 phone이 있는 앱의 폰 사본은 `sync`와 상관없이 모든
     표를 갖는다.
-  `sync`가 표를 보내는 앱은 컴퓨터에서 sync 앱이라 보내는 표에 `runs_on`에 phone이 있는 앱과 같은 schema 규칙(text id, 정수
-  PK·AUTOINCREMENT·PK 밖의 UNIQUE와 CHECK 없음, 그 표에 건 trigger 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0
-  이상을 고정해야 한다. 보내지 않는 표에는 이 규칙이 없다. 보내지 않는 표에 건 trigger는 보내는 표에 써도 된다. 보내는 표는
-  보내지 않는 표를 foreign key로 가리키지 못하고, 보내지 않는 표가 보내는 표를 가리킬 때는 `ON DELETE`·`ON UPDATE`의 `CASCADE`·
-  `SET NULL`·`SET DEFAULT`를 쓰지 못한다(다른 컴퓨터에서 온 변경은 그 동작을 돌리지 않는다). 보내는 표끼리의 foreign key는
-  같은 destination일 때만 된다(한 destination만 받는 컴퓨터에는 부모 줄이 없다). 컴퓨터마다 생기는 줄(그 컴퓨터의
-  원본에서 모은 집계)을 보내면 PRIMARY KEY에 그 컴퓨터의 id를 넣는다: 같은 key를 두 컴퓨터가 쓰면 칸마다 나중 것이 이겨
-  서로의 값을 덮는다.
+  동기화하는 표에는 `runs_on`에 phone이 있는 앱과 같은 schema 규칙(text id, 정수 PK·AUTOINCREMENT·PK 밖의 UNIQUE와 CHECK 없음,
+  그 표에 건 trigger 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0 이상을 고정해야 한다. `"local"`로 뺀 표에는 이 규칙이 없다.
+  `"local"` 표에 건 trigger는 동기화하는 표에 써도 된다. 동기화하는 표는 `"local"` 표를 foreign key로 가리키지 못하고, `"local"` 표가
+  동기화하는 표를 가리킬 때는 `ON DELETE`·`ON UPDATE`의 `CASCADE`·`SET NULL`·`SET DEFAULT`를 쓰지 못한다(다른 컴퓨터에서 온 변경은 그 동작을
+  돌리지 않는다). 동기화하는 표끼리의 foreign key는 같은 destination일 때만 된다(한 destination만 받는 컴퓨터에는 부모 줄이 없다). 컴퓨터마다
+  생기는 줄(그 컴퓨터의 원본에서 모은 집계)을 보내면 PRIMARY KEY에 그 컴퓨터의 id를 넣는다. 글 칸(메모·문서 본문)처럼 동시 수정 때 양쪽 글을
+  모두 남겨야 하는 표에는 `conflict: "keep_both"`를 고른다.
```
