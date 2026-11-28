# @lophn/declaration 6.1.0

Previous: 6.0.0
Breaking: no. Move together with `@lophn/app-ui` 2.26.1 or `@lophn/app-ui-native` 1.12.1 (they depend on this exact version).

A `tray` popup can now be as small as its content. The lower limits of a screen's `tray` size dropped: width is now 120-720 px (was 240-720) and height 80-720 px (was 160-720). The size is the whole popup, including lophn's head row (screen name and pin, about 36 px).

lophn also changed how a ranged width fits, for every app and every SDK version: a side declared as `{ min?, max? }` now grows and shrinks to the content in both directions. The width follows the width the content needs without wrapping (max-content). Before, the width started at `min` and only widened when the content overflowed, so a popup never got narrower than `min` and a small table left empty space to its right. A missing `min` is the lower limit (120 wide, 80 tall).

```ts
// lophn.ts, before: the popup stayed at least 240 x 160, wider and taller than a three-line summary
screens: [
  { key: "status", label: "Status", path: "/status", places: ["tray"],
    tray: { width: { min: 240, max: 480 }, height: { min: 160, max: 480 } } },
],

// after: the popup wraps the content tightly, down to 120 x 80
screens: [
  { key: "status", label: "Status", path: "/status", places: ["tray"],
    tray: { width: { max: 480 }, height: { max: 480 } } },
],
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/6.0.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/6.1.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`).

For the fit to work, the tray screen must not give `html`, `body` or its root element `height: 100%`, `100vh`, `width: 100vw` or a fixed width. If it does, lophn cannot see the content size and the popup stays at that size. Long text makes the popup as wide as `max` before it wraps; give a text-heavy tray screen the `max` width you want to read at.

Nothing is required of an existing app. A numeric side stays fixed. A ranged width that used to sit at `min` now follows the content, so a popup with little content gets narrower and one with long lines gets wider (up to `max`); if you want the old look, declare the width as a number. To let a small tray popup shrink below 240 x 160, move to this version, lower or drop `min`, and release again; the size is fixed in the release. A declaration with a bound under 240 wide or 160 tall is refused by a copy of this SDK older than 6.1.0.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, change the guide path example to `6.1.0`. If the app edited that part, keep the app's own additions.
- From now on, give a `tray` screen a range on both sides (for example `tray: { width: { max: 480 }, height: { max: 480 } }`) so the popup wraps its content, and keep its html, body and root element free of `height: 100%`, `100vh`, `width: 100vw` and fixed widths. Use a number only when the popup must keep one size.

```diff
# design-app skill
@@ -153,9 +153,9 @@ Each screen declares `places`. They decide where people can open it:
   and put them first. The popup is 360 x 480 px by default. Set its size on
-  the screen with `tray: { width, height }` in px (width 240-720, height
-  160-720, either may be left out). Each side is a number (fixed) or
-  `{ min?, max? }`, which fits the screen's content inside that range. Prefer
-  a range for content that grows, such as a list: `height: { max: 480 }`
-  keeps a short list short. For the height to fit, do not give html, body or
-  the root element `height: 100%`. lophn shrinks the popup to fit a small
-  window.
+  the screen with `tray: { width, height }` in px, head included (width
+  120-720, height 80-720, either optional). Each side is a number (fixed)
+  or `{ min?, max? }`, which fits the popup to the content inside that
+  range. Prefer a range on both sides: `{ max: 480 }` wraps a small table
+  and keeps a short list short. To fit, do not give html, body or the root
+  element `height: 100%`, `100vh`, `width: 100vw` or a fixed width. lophn
+  shrinks it to fit a small window.
 - `phone`: the lophn phone app. It stands alone: a screen with `phone` has no

# app template AGENTS.md
@@ -25,3 +25,3 @@ Package를 쓴다.
 - 내장 SDK의 사용법은 설치 사본의 `guide.md`(예:
-  `.lophn/sdk/declaration/6.0.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
+  `.lophn/sdk/declaration/6.1.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
   필요하면 `lophn.ts`의 의존 선언과 `package.json`의 의존을 같은 정확한

# @lophn/declaration guide.md
@@ -43,15 +43,19 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     - 숫자: 그 크기로 고정한다.
-    - `{min?, max?}`: 화면 내용에 맞춰 그 범위 안에서 늘고 준다. 높이는 내용 높이를 따른다
-      (목록이 짧으면 짧고, max를 넘으면 popup 안에서 스크롤한다). 너비는 min(없으면 기본값을
-      범위 안으로 맞춘 값)에서 시작해 내용이 가로로 넘칠 때만 max까지 넓어진다. 높이를 맞추려면
-      html·body·root 요소에 `height: 100%`를 두지 않는다(그러면 내용 높이를 잴 수 없어
-      처음 높이에 머문다).
-
-    너비는 240~720, 높이는 160~720의 정수이고 min은 max보다 클 수 없다. `places`에 `tray`가
-    없는 화면에 두면 선언 오류다. 창이 더 작으면 lophn이 창 안으로 줄인다. 크기는 release에
-    고정되므로 바꾸려면 다시 release한다.
+    - `{min?, max?}`: popup이 화면 내용에 꼭 맞게 그 범위 안에서 늘고 준다. 빈 끝은 아래 한계다
+      (`{max: 480}`의 min은 가장 작은 값).
+      - 높이는 내용 높이를 따른다(목록이 짧으면 짧고, max를 넘으면 popup 안에서 스크롤한다).
+      - 너비는 내용이 줄을 바꾸지 않고 다 보이는 너비(max-content)를 따른다. 작은 표는 표만큼
+        좁아지고, 긴 글은 max까지 넓어진 뒤 줄을 바꾼다.
+      - 맞추려면 html·body·root 요소에 `height: 100%`·`100vh`나 `width: 100vw`·고정 너비를
+        두지 않는다(그러면 내용 크기를 잴 수 없어 그 크기에 머문다).
+
+    popup 전체(화면 이름과 pin이 있는 머리 줄 약 36px 포함)의 크기다. 너비는 120~720, 높이는
+    80~720의 정수이고 min은 max보다 클 수 없다. `places`에 `tray`가 없는 화면에 두면 선언
+    오류다. 창이 더 작으면 lophn이 창 안으로 줄인다. 크기는 release에 고정되므로 바꾸려면 다시
+    release한다.
 
     ```ts
+    // 두세 줄짜리 요약 표: 표 크기에 꼭 맞는다
     { key: "status", label: "Status", path: "/status", places: ["tray"],
-      tray: { width: { max: 520 }, height: { min: 160, max: 480 } } }
+      tray: { width: { max: 480 }, height: { max: 480 } } }
     ```
@@ -225,3 +229,3 @@ const declaration = defineApp({
   app_connections: [],
-  sdk_dependencies: [{ name: "@lophn/declaration", version: "6.0.0" }],
+  sdk_dependencies: [{ name: "@lophn/declaration", version: "6.1.0" }],
 });
```
