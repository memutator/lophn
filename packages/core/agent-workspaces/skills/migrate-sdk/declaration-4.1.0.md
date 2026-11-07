# @lophn/declaration 4.1.0

Previous: 4.0.0
Breaking: no. Move together with `@lophn/app-ui` 2.8.0.

A screen with the `tray` place can set its tray popup size with a `tray` field: `{ width?, height? }` in px. Width is an integer from 240 to 720, height from 160 to 720, and at least one is given. A side that is left out keeps the default (width 360, height 480). lophn shrinks the popup to fit a small window. `tray` on a screen without the `tray` place is a declaration error. The new type is `TraySize`.

```ts
// before: the popup is always 360 x 480
screens: [{ key: "status", label: "Status", path: "/status", places: ["tray"] }],

// after: a short status line in a wide, low popup
screens: [
  {
    key: "status",
    label: "Status",
    path: "/status",
    places: ["tray"],
    tray: { width: 420, height: 300 },
  },
],
```

Nothing is required of an existing app. Without `tray`, the popup stays 360 x 480. If your tray screen has a lot of empty space or always scrolls, set the size its content needs (not the largest) and release again; the size is fixed in the release.

To move to this version, change `@lophn/declaration` to `4.1.0` and `@lophn/app-ui` to `2.8.0` in both `lophn.ts` (`sdk_dependencies`) and `package.json`.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, add the new template line below after the line about `sidebar` and `tray` being shown as soon as they are declared, and change the guide path example to `4.1.0`. If the app edited that part, keep the app's own additions.
- From now on, when you make a `tray` screen, decide whether the default 360 x 480 fits its content, and set `tray: { width, height }` when it does not.

```diff
# app template AGENTS.md
@@ -25,3 +25,3 @@ Package를 쓴다.
 - 내장 SDK의 사용법은 설치 사본의 `guide.md`(예:
-  `.lophn/sdk/declaration/4.0.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
+  `.lophn/sdk/declaration/4.1.0/guide.md`)를 읽는다. 새 SDK Package나 의존이
@@ -60,2 +60,3 @@ Package를 쓴다.
   `sidebar`와 `tray`는 선언하면 바로 나오고 사람이 Settings에서 끈다.
+  tray popup은 기본 360×480px이다. 내용에 맞는 크기가 따로 있으면 그 화면에 `tray: { width, height }`(px)를 적는다.

# design-app skill
@@ -133,3 +133,6 @@ Each screen declares `places`. They decide where people can open it:
   the one or two actions that matter at a glance, such as refresh, an `icon`
-  and put them first.
+  and put them first. The popup is 360 x 480 px by default. If the content
+  wants another size, set it on the screen: `tray: { width, height }` in px
+  (width 240-720, height 160-720, either may be left out). Pick the size the
+  content needs, not the largest; lophn shrinks it to fit a small window.

# @lophn/declaration guide.md
@@ -27,3 +27,3 @@
-- `screens` — 화면 목록이다. 항목은 `{key, label, path, places, params?}`다. `places`는
+- `screens` — 화면 목록이다. 항목은 `{key, label, path, places, params?, tray?}`다. `places`는
@@ -36,2 +36,12 @@
   - `tray` — 작업 표시줄 tray popup이다.
+  - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 너비는
+    240~720, 높이는 160~720의 정수이고 둘 중 하나는 있어야 한다. 없는 쪽은 기본값
+    (너비 360, 높이 480)이다. `places`에 `tray`가 없는 화면에 두면 선언 오류다. 창이
+    더 작으면 lophn이 창 안으로 줄인다. 크기는 release에 고정되므로 바꾸려면 다시
+    release한다.
```
