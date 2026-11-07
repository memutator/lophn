# @lophn/declaration 4.2.0

Previous: 4.1.0
Breaking: no. Move together with `@lophn/app-ui` 2.9.0.

Each side of a screen's `tray` size can now be a range `{ min?, max? }` instead of a number. A number still fixes that side. A range fits the screen's content inside it: the height follows the content height (a short list gives a short popup, and past `max` the popup scrolls), and the width starts at `min` (or the default fitted into the range) and widens up to `max` only when the content overflows sideways. Each bound keeps the old limits (width 240-720, height 160-720), at least one of `min` and `max` is given, and `min` is not greater than `max`. The new type is `TraySide`.

```ts
// before: always 420 x 480, even for a two-line list
screens: [
  { key: "status", label: "Status", path: "/status", places: ["tray"], tray: { width: 420, height: 480 } },
],

// after: as tall as the list, up to 480
screens: [
  {
    key: "status",
    label: "Status",
    path: "/status",
    places: ["tray"],
    tray: { width: 420, height: { min: 160, max: 480 } },
  },
],
```

For the height to fit, the tray screen must not give `html`, `body` or its root element `height: 100%` (or `100vh`). If it does, lophn cannot see the content height and the popup stays at its first height.

Nothing is required of an existing app. A numeric `tray` size keeps working. If your tray screen's content changes length, switch that side to a range and release again; the size is fixed in the release.

To move to this version, change `@lophn/declaration` to `4.2.0` and `@lophn/app-ui` to `2.9.0` in both `lophn.ts` (`sdk_dependencies`) and `package.json`.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, replace the template's tray size line with the new lines below, and change the guide path example to `4.2.0`. If the app edited that part, keep the app's own additions.
- From now on, give a `tray` screen whose content changes length (a list, a feed) a range such as `height: { max: 480 }` instead of a fixed height, and keep its html, body and root element free of `height: 100%`.

```diff
# design-app skill
@@ -133,6 +133,10 @@ Each screen declares `places`. They decide where people can open it:
   the one or two actions that matter at a glance, such as refresh, an `icon`
-  and put them first. The popup is 360 x 480 px by default. If the content
-  wants another size, set it on the screen: `tray: { width, height }` in px
-  (width 240-720, height 160-720, either may be left out). Pick the size the
-  content needs, not the largest; lophn shrinks it to fit a small window.
+  and put them first. The popup is 360 x 480 px by default. Set its size on
+  the screen with `tray: { width, height }` in px (width 240-720, height
+  160-720, either may be left out). Each side is a number (fixed) or
+  `{ min?, max? }`, which fits the screen's content inside that range. Prefer
+  a range for content that grows, such as a list: `height: { max: 480 }`
+  keeps a short list short. For the height to fit, do not give html, body or
+  the root element `height: 100%`. lophn shrinks the popup to fit a small
+  window.
 

# app template AGENTS.md
@@ -25,3 +25,3 @@ Package를 쓴다.
 - 내장 SDK의 사용법은 설치 사본의 `guide.md`(예:
-  `.lophn/sdk/declaration/4.1.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
+  `.lophn/sdk/declaration/4.2.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
   필요하면 `lophn.ts`의 의존 선언과 `package.json`의 의존을 같은 정확한
@@ -60,3 +60,4 @@ Package를 쓴다.
   `sidebar`와 `tray`는 선언하면 바로 나오고 사람이 Settings에서 끈다.
-  tray popup은 기본 360×480px이다. 내용에 맞는 크기가 따로 있으면 그 화면에 `tray: { width, height }`(px)를 적는다.
+  tray popup은 기본 360×480px이다. 크기는 그 화면에 `tray: { width, height }`(px)로 적고, 각 쪽은 숫자(고정)나
+  `{ min?, max? }`(내용에 맞춰 그 안에서 늘고 준다)다. 목록처럼 길이가 바뀌는 화면은 `height: { max: 480 }` 같은 범위를 쓴다.
   `params`는 화면이 받는 인자다. 옆에 두고 쓸 한 가지 일은 `panel` 화면으로 따로 만들고,

# @lophn/declaration guide.md
@@ -20,3 +20,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `CommandDeclaration`, `Place`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
-  `SkillDeclaration`, `SDKDependency`, `TraySize`, `ValidationResult`, `ValidationError`
+  `SkillDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
 
@@ -36,7 +36,14 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   - `tray` — 작업 표시줄 tray popup이다.
-  - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 너비는
-    240~720, 높이는 160~720의 정수이고 둘 중 하나는 있어야 한다. 없는 쪽은 기본값
-    (너비 360, 높이 480)이다. `places`에 `tray`가 없는 화면에 두면 선언 오류다. 창이
-    더 작으면 lophn이 창 안으로 줄인다. 크기는 release에 고정되므로 바꾸려면 다시
-    release한다.
+  - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 둘 중 하나는
+    있어야 하고 없는 쪽은 기본값(너비 360, 높이 480)이다. 각 쪽은 둘 중 하나다.
+    - 숫자: 그 크기로 고정한다.
+    - `{min?, max?}`: 화면 내용에 맞춰 그 범위 안에서 늘고 준다. 높이는 내용 높이를 따른다
+      (목록이 짧으면 짧고, max를 넘으면 popup 안에서 스크롤한다). 너비는 min(없으면 기본값을
+      범위 안으로 맞춘 값)에서 시작해 내용이 가로로 넘칠 때만 max까지 넓어진다. 높이를 맞추려면
+      html·body·root 요소에 `height: 100%`를 두지 않는다(그러면 내용 높이를 잴 수 없어
+      처음 높이에 머문다).
+
+    너비는 240~720, 높이는 160~720의 정수이고 min은 max보다 클 수 없다. `places`에 `tray`가
+    없는 화면에 두면 선언 오류다. 창이 더 작으면 lophn이 창 안으로 줄인다. 크기는 release에
+    고정되므로 바꾸려면 다시 release한다.
 
@@ -44,3 +51,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     { key: "status", label: "Status", path: "/status", places: ["tray"],
-      tray: { width: 420, height: 300 } }
+      tray: { width: { max: 520 }, height: { min: 160, max: 480 } } }
     ```
@@ -116,3 +123,3 @@ const declaration = defineApp({
   app_connections: [],
-  sdk_dependencies: [{ name: "@lophn/declaration", version: "4.1.0" }],
+  sdk_dependencies: [{ name: "@lophn/declaration", version: "4.2.0" }],
 });
```
