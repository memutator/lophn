# @lophn/declaration 4.9.0

Previous: 4.8.0
Breaking: no. Move together with `@lophn/app-ui` 2.18.0 and `@lophn/app-ui-native` 1.4.0.

A declaration can now say where the app's data goes when the person keeps their lophn on more than one computer (`sync_to`). It is optional. A declaration without it is unchanged, including its hash: the app's data is not sent anywhere.

`sync_to` is the name of a destination, for example `"personal"`: lowercase letters, digits and `-`, starting with a letter, up to 32 characters. It is only a name. The folder it points to is a setting the person makes on each computer, so the same declaration is right on every computer, and a computer that has no destination of that name neither sends nor reads this app's data. Something outside lophn moves that folder between the computers.

Two checks, both `invalid_input`:

- `sync_to must be a destination name: lowercase letters, digits and -, starting with a letter, up to 32`
- `runs_on ["phone"]: sync_to has nothing to send; a phone's data reaches a folder only through a computer`

An app with `sync_to` is a sync app on the computer, so release preparation holds it to the same rules as an app that runs on the phone: text primary keys made with `newId()`, no `AUTOINCREMENT`, no trigger, no `UNIQUE` or `CHECK` outside the primary key, and `@lophn/cap-store` 2.0.0 or later in `sdk_dependencies`. Two computers that both make the same integer id would lose a row. An app with `sync_to` and without `"phone"` in `runs_on` does not need `@lophn/cap-tool` 2.2.0.

```ts
// sync_to, in lophn.ts
sync_to: "personal",
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.8.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.17.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.18.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`); if the app has phone screens, also move `@lophn/app-ui-native` to 1.4.0. Nothing is required of an existing app: existing declarations validate as before and keep their data on the computer. Add `sync_to` only when the person wants this app's data on their other computers too.

## Instruction diff

The SDK guide gained the `sync_to` entry, the `design-app` skill gained the bundled file `folder-sync.md`, and the app template gained two lines about `sync_to`. Make the lophn-managed part of this app's `AGENTS.md` match the new template lines below. If you build or change an app that should keep its data on more than one computer, read the guide entry and `folder-sync.md` (`skill.read({ name: "design-app", path: "folder-sync.md" })`) before you design the data or set up a sync folder: the schema rules above are checked when the release is prepared and reject the app otherwise, and a sync folder is set only with the person's approval after you explain what goes where. Leave `sync_to` out for every other app.

```diff
# @lophn/declaration guide.md
@@ -26 +26 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`, `sync_to`만 있다. 알 수 없는 칸은 거절한다.
@@ -117,0 +118,7 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
+- `sync_to` — 이 앱의 data를 어느 destination으로 내보내는가. destination 이름 하나다(`"personal"`).
+  소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 칸이 없으면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다.
+  값은 이름뿐이다: 이름이 가리키는 폴더 경로는 사람이 기계마다 따로 정하는 설정이라 같은 선언이 어느 기계에서나 맞고,
+  이 기계에 그 이름의 destination이 없으면 이 기계는 그 앱의 data를 내보내지도 읽지도 않는다. 바깥 도구가 그 폴더를
+  다른 기계로 옮긴다. `["phone"]`인 앱은 쓰지 못한다(폰의 data는 컴퓨터를 거쳐서만 나가는데 그 앱은 컴퓨터 사본이 없다).
+  `sync_to`가 있는 앱은 컴퓨터에서 sync 앱이라 `runs_on`에 phone이 있는 앱과 같은 schema 규칙(text id, 정수 PK·
+  AUTOINCREMENT·trigger·PK 밖의 UNIQUE와 CHECK 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0 이상을 고정해야 한다.
```

```diff
# design-app SKILL.md
@@ -302 +302,3 @@ bundled `phone-check.md`; for home screen widgets (`widgets`) and phone location
-also run on the phone (`runs_on`), first read `phone-apps.md`. Read each with
+also run on the phone (`runs_on`), first read `phone-apps.md`; when the app's
+data must reach the person's other computers (`sync_to`), first read
+`folder-sync.md`. Read each with
```

```diff
# app template AGENTS.md
@@ -73,0 +74,2 @@ Package를 쓴다.
+  `sync_to`는 앱의 data를 사람의 다른 컴퓨터로 보낼 destination 이름이다. 없으면 data는 이 기계에만 있다.
+  쓰기 전에 `design-app` skill의 bundled file `folder-sync.md`를 읽고 따른다(정책 고르기, 사람에게 설명, 폴더를 옮기는 도구).
```
