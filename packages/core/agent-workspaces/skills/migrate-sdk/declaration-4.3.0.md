# @lophn/declaration 4.3.0

Previous: 4.2.0
Breaking: no. Move together with `@lophn/app-ui` 2.10.0.

A declaration can now list the keyboard shortcuts of its app with `keys`. Each key has an `id` (its name in the app, 1-64 characters of letters, digits, `_ - .`, unique among the keys), a one-line `title` that Settings › Keyboard shows, and the chord for Linux and Windows in `key.other`. `key.mac` is the chord for macOS and defaults to `key.other`. A chord is one key with a modifier (`Ctrl`, `Cmd`, `Alt`, `Shift`) or a function key `F1` to `F12`. Two-stroke chords are rejected. `context` is optional and only sets the context name that Settings shows. A declaration without `keys` is unchanged, including its hash.

A key does nothing by itself. The screen must register its handler with `useCommand` from `@lophn/app-ui` 2.10.0.

```ts
// before
export default defineApp({
  name: "notes",
  // ...
});

// after
export default defineApp({
  name: "notes",
  // ...
  keys: [
    { id: "save", title: "Save note", key: { other: "Ctrl+KeyS", mac: "Cmd+KeyS" } },
  ],
});
```

Nothing is required of an existing app. Add `keys` only for a main action of a screen that is worth a shortcut.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- When a screen has a main action worth a keyboard shortcut, declare it in `keys` in `lophn.ts` and register its handler with `useCommand` (see `@lophn/app-ui` 2.10.0). Do not take a key the shell uses for tabs (for example Ctrl+W), because lophn takes that key before the app sees it.
- In the app's `lophn.ts`, the template comment now lists key among the things you add when needed.

```diff
# app template lophn.ts
@@ -7,3 +7,3 @@ export default defineApp({
   description: "A lophn app.",
-  // 화면, operation, command는 필요할 때 더한다. 화면은 src/screens/<key>/, handler는 src/handlers.ts에 둔다.
+  // 화면, operation, command, key(단축키)는 필요할 때 더한다. 화면은 src/screens/<key>/, handler는 src/handlers.ts에 둔다.
   // operation은 화면과 앱 자신이 쓰는 동작이다(agent는 못 본다). command는 agent와 다른 앱이 부르는 의미 단위다.
@@ -28,3 +28,3 @@ export default defineApp({
     { name: "@lophn/ui", version: "1.1.0" },
-    { name: "@lophn/app-ui", version: "2.9.0" },
+    { name: "@lophn/app-ui", version: "2.10.0" },
     { name: "@lophn/agent", version: "1.3.0" },
# @lophn/declaration guide.md
@@ -20,3 +20,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `CommandDeclaration`, `Place`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
-  `SkillDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
+  `SkillDeclaration`, `AppKeyDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
 
@@ -25,3 +25,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
 `name`, `description`, `screens`, `operations`, `commands`, `permissions`,
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`만 있다. 알 수 없는 칸은 거절한다.
 
@@ -71,2 +71,12 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `removed_public_skills`에 그 skill이 실린다.
+- `keys` — 앱이 내는 key(단축키) 목록이다. 항목은 `{id, title, key: {mac?, other}, context?}`다.
+  - `id`는 이 앱 안의 이름이다(영문·숫자·`_ - .`, 1~64자, 겹치지 못한다). Settings › Keyboard에는
+    `app.<앱 id>.<id>` command의 줄로 보이고 사람이 바꿀 수 있다. `title`은 그 줄의 이름이다(한 줄).
+  - `key.other`는 Linux·Windows의 key, `key.mac`은 macOS의 key다. `mac`이 없으면 `other`와 같다.
+    key는 홑 타 하나이고 modifier(`Ctrl`·`Cmd`·`Alt`·`Shift`)가 있거나 F1~F12여야 한다(글 입력을 삼키지 않게).
+    예 `"Ctrl+KeyS"`, `"Cmd+KeyS"`, `"F5"`. 두 타 key(`"Ctrl+KeyX Ctrl+KeyE"`)는 선언할 수 없다.
+  - `context`는 Settings 줄에 쓰는 context 이름이다. 빼면 `app:<앱 id>`다. 보통 빼 둔다.
+  - key는 화면이 `@lophn/app-ui`의 `useCommand`로 같은 `id`에 handler를 건 동안만 돈다. handler가 없으면 줄만 보이고
+    아무 일도 없다. 앱 안에서 맞은 key는 앱이 가져가고, 앱이 맞추지 않은 shell key(탭 이동, palette 등)는 shell이 돈다.
+    `main`이 먼저 받는 key(탭 닫기 Ctrl+W 등)는 앱에 닿기 전에 shell이 가져가므로 앱 key로 주지 않는다.
 - `operations` — 앱 안의 operation 목록이다. 화면(`lophnApp.callOperation`)과 앱
```
