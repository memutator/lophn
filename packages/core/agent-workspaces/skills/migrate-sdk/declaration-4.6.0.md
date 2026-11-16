# @lophn/declaration 4.6.0

Previous: 4.5.1
Breaking: no. Move together with `@lophn/app-ui` 2.15.0.

A screen can now list the `phone` place: `places: ["phone"]`. `phone` is a screen the lophn phone app draws, and it stands alone: combining it with `tab`, `panel`, `card`, `sidebar` or `tray` in one screen's `places` is a declaration error (`screen <key>: phone is its own place; it cannot be combined with tab, panel, card, sidebar or tray`). The `Place` type gains `"phone"`.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.1",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.1",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.15.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app: existing screens and declarations validate as before. Existing supported SDK versions remain supported.

## Instruction diff

The SDK guide and the instructions now tell how to write a phone screen: `places: ["phone"]` alone in a screen, the source `src/screens/<key>/phone.tsx` (no `main.tsx`, no `index.html` in that folder), the packages it needs (`@lophn/ui-native` and `@lophn/app-ui-native` with their peers, all in `devDependencies`), the phone rules, and how to check the screen in the desktop preview. The skill `design-app` has the whole procedure in its section "Phone screens"; read it before you make a phone screen. Make one only when the person asks for it.

Do this:

- Edit the lophn-managed part of your app's `AGENTS.md` to the new `places` lines below. Leave the rest of the file as it is.
- When you add the first phone screen, also update the two files lophn made in the app, as the diff shows: `tests/declaration_test.ts` (a phone screen has `phone.tsx` and no `main.tsx`; the pin check also reads `devDependencies`) and `scripts/build-ui.ts` (`npm run build` skips a folder that has `phone.tsx`). Without them `npm test` fails on the phone screen's source and on the kit pins.
- Do not mix `phone` with other places in one screen. A desktop twin is another screen with its own key.
- Follow the order of "Phone screens" in `design-app` for a phone screen: read the person's reference phone with `lophn app phone-target`, declare the screen, add the packages, write the screen, check it in the preview with `lophn tab open --preview <app> --screen <key>`.

````diff
# @lophn/declaration guide.md
@@ -36,2 +36,6 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   - `tray` — 작업 표시줄 tray popup이다.
+  - `phone` — 폰 앱이 그리는 React Native 화면이다. 혼자 서는 자리라 `places`에 다른 자리와 같이 쓰면 선언 오류다
+    (desktop 짝이 필요하면 key가 다른 화면을 하나 더 둔다). `path`는 `/screens/<key>/index.html`이고 소스는
+    `src/screens/<key>/phone.tsx`다(default export가 component이고, 그 dir에 `main.tsx`·`index.html`을 두지 않는다).
+    의존, 폰 규칙, 확인은 `design-app` skill의 Phone screens와 `@lophn/ui-native` guide를 읽는다.
   - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 둘 중 하나는
# skill design-app (SKILL.md)
@@ -161,2 +161,5 @@ Each screen declares `places`. They decide where people can open it:
   window.
+- `phone`: the lophn phone app. It stands alone: a screen with `phone` has no
+  other place. It is written in React Native, not as a desktop screen; see
+  "Phone screens".
 
@@ -188,2 +191,110 @@ Panels are where an app is used most often, so design them on purpose:
 
+## Phone screens
+
+A phone screen is a screen of the lophn phone app, written in React Native
+with the phone kit `@lophn/ui-native`. Make one only when the person asks to
+use the app on their phone. One app has desktop screens and phone screens
+together. They are different files (`src/screens/<key>/phone.tsx` and
+`main.tsx`) and share the operations and the data. Do not make one screen
+responsive for both.
+
+1. Read the person's reference phone: `lophn app phone-target` gives `device`
+   (name, OS, `width` and `height` in CSS px, `dpr`). `width` and `height` are
+   the whole phone screen; lophn's top line takes part of the height. If
+   `device` is null, tell the person to pair their phone and stop; do not draw
+   for a guessed size. Draw for that width and build no responsive layout. When
+   the person pairs another phone it becomes the reference: draw again the
+   screens you drew for the old size.
+2. Declare the screen in `lophn.ts`, alone in `places`:
+   `{ key: "orders", label: "Orders", path: "/screens/orders/index.html",
+   places: ["phone"] }`. The source is `src/screens/orders/phone.tsx`, which
+   default-exports the component. Do not put `main.tsx` or `index.html` in that
+   folder: a screen folder has one or the other, and release prepare builds the
+   phone screen itself (`npm run build` skips it). A desktop twin is a second
+   screen with another key.
+3. Add the packages after reading the guides of `@lophn/ui-native` and
+   `@lophn/app-ui-native` (`lophn package read <name>`). Put both in
+   `package.json` `devDependencies` (`file:.lophn/sdk/<name>/<version>`) and in
+   `lophn.ts` `sdk_dependencies`, with the same exact version. Put the kit's
+   peers (`react-native`, `react-native-svg`, `react-native-safe-area-context`,
+   `react-native-keyboard-controller`, `expo-clipboard`, `lucide-react-native`)
+   and `react-native-web` in `devDependencies` too, at the versions the
+   `@lophn/ui-native` guide lists; skip one the app already has. Then run
+   `npm install`. Never use `dependencies` for them: the phone app already
+   carries the kit, so release prepare drops `devDependencies` from the bundle
+   and refuses a kit that sits in `dependencies`.
+4. Write the screen by the rules below, then run `npm run check`, which type
+   checks it.
+5. Check it as described after the rules.
+
+Rules:
+
+- The root is `Screen`. Give it `top={<TopBar left="none" title="Orders" />}`:
+  `TopBar` shows lophn's sidebar button by default (`left="menu"`), and an app
+  screen has no sidebar.
+- A touch target is 44 or more. `Row` and `IconButton` already are. A `Button`
+  is 34 (`sm`) or 42 (`md`) high, so use `size="lg"` (54) for the main action of
+  a screen, and give a `Pressable` of your own `minHeight: 44`. Nothing depends
+  on hover.
+- Text sits in `Text`, with its `variant` and `tone`; do not set `fontSize`
+  (the person's text scale applies). Chrome takes its colors from `useTheme()`,
+  not from color values. The kit gives the fonts.
+- Native modules come only from this list, imported by their package name (no
+  sub-path such as `react-native/...`): `react`, `react/jsx-runtime`,
+  `react-native`, `react-native-svg`, `react-native-safe-area-context`,
+  `lucide-react-native`, `@lophn/ui-native`, `@lophn/app-ui-native`. Plain JS
+  packages of the app are bundled in. `@lophn/ui`, `@lophn/app-ui`, `react-dom`,
+  other `react-native-*` and `expo-*` packages and Node built-ins make release
+  prepare fail with a `file:line:column: reason` line that says what to use
+  instead.
+- There is no network: no `fetch`, no WebSocket. Data comes only through
+  operations (`useOperation`, `OperationButton`) and events (`useEvent`), and
+  the declaration must list them. Images are the kit's `Icon` and `data:`
+  URIs.
+
+An example, `src/screens/orders/phone.tsx`:
+
+```tsx
+import { useEffect, useState } from "react";
+import { Group, Row, Screen, TopBar } from "@lophn/ui-native";
+import { OperationButton, useOperation } from "@lophn/app-ui-native";
+
+const list = { name: "list-orders", title: "List orders" };
+const archive = { name: "archive-shipped", title: "Archive shipped" };
+
+export default function Orders() {
+  const [orders, setOrders] = useState<{ id: string; status: string }[]>([]);
+  const load = useOperation(list);
+  const reload = async () => {
+    const result = await load.run({});
+    if (result?.ok) setOrders(result.value as typeof orders);
+  };
+  useEffect(() => void reload(), []);
+  const main = <OperationButton operation={archive} size="lg" onDone={() => void reload()} />;
+  return (
+    <Screen scroll tone="floor" top={<TopBar left="none" title="Orders" />} footer={main}>
+      <Group>{orders.map((o) => <Row key={o.id} title={`Order ${o.id}`} sub={o.status} />)}</Group>
+    </Screen>
+  );
+}
+```
+
+Check it on the desktop:
+
+1. Commit, run `lophn release prepare`, then `lophn preview start`. The tab
+   that opens by itself is the first `tab` screen, so a phone-only app gets
+   none; the preview still runs.
+2. `lophn tab open --preview <app> --screen <key>` opens the screen in a frame
+   of the reference phone's size. With no registered phone it is `conflict`:
+   pair a phone, or pass `--device <name>`.
+3. Look and press with `lophn browser snapshot|screenshot|act <tab>`. Run an
+   operation with `lophn preview call`.
+
+The preview draws with react-native-web, so the phone can differ: text input,
+the soft keyboard, scrolling, fonts, the safe area. When you report, say what
+you saw in the desktop preview and what you could not see on the phone, and
+that the person makes the last check on their phone. If the phone app is older
+than the kit the screen was built with, the phone shows "update the lophn app";
+tell the person.
+
 ## Talking to an agent from a screen
# AGENTS.md (the lophn-managed part)
@@ -67,2 +67,4 @@ Package를 쓴다.
   `card`는 agent 대화 안, `sidebar`는 오른쪽 sidebar, `tray`는 작업 표시줄 tray popup이다.
+  `phone`은 폰 앱이 그리는 React Native 화면이고 혼자만 쓴다(소스는 `src/screens/<key>/phone.tsx`).
+  폰 화면은 `design-app` skill의 Phone screens를 읽는다.
   `sidebar`와 `tray`는 선언하면 바로 나오고 사람이 Settings에서 끈다.
# tests/declaration_test.ts
@@ -3,3 +3,3 @@
 import assert from "node:assert/strict";
-import { readFileSync, statSync } from "node:fs";
+import { existsSync, readFileSync, statSync } from "node:fs";
 import { test } from "node:test";
@@ -46,3 +46,5 @@ test("declaration: every screen has a source and its path is the screen entry",
     assert.deepStrictEqual(screen.path, `/screens/${screen.key}/index.html`);
-    for (const file of ["index.html", "main.tsx"]) {
+    // 폰 화면은 phone.tsx 하나다(index.html은 release 준비가 짓는다). 그 밖의 화면은 index.html과 main.tsx다.
+    const phone = screen.places.includes("phone");
+    for (const file of phone ? ["phone.tsx"] : ["index.html", "main.tsx"]) {
       const info = statSync(
@@ -52,2 +54,8 @@ test("declaration: every screen has a source and its path is the screen entry",
     }
+    if (phone) {
+      assert.ok(
+        !existsSync(new URL(`src/screens/${screen.key}/main.tsx`, root)),
+        `${screen.key} is a phone screen and must not have main.tsx`,
+      );
+    }
   }
@@ -58,5 +66,10 @@ test("declaration: sdk_dependencies are exact and match package.json", () => {
     readFileSync(new URL("package.json", root), "utf8"),
-  ) as { dependencies?: Record<string, string> };
+  ) as {
+    dependencies?: Record<string, string>;
+    devDependencies?: Record<string, string>;
+  };
   const pinned = new Set<string>();
-  for (const [name, value] of Object.entries(config.dependencies ?? {})) {
+  // 폰 화면의 kit(`@lophn/ui-native`, `@lophn/app-ui-native`)은 devDependencies에 있다.
+  const all = { ...config.devDependencies, ...config.dependencies };
+  for (const [name, value] of Object.entries(all)) {
     const match = /^file:\.lophn\/sdk\/(?:@me\/)?[^/]+\/([^/]+)$/.exec(value);
# scripts/build-ui.ts
@@ -3,2 +3,3 @@
 // 하지 않고 release 준비가 bundle에 담은 이 결과만 읽는다(apps/sdk#R10, R34).
+import { existsSync } from "node:fs";
 import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
@@ -10,3 +11,4 @@ const root = join(import.meta.dirname, "..");
 
-// 화면은 src/screens/<key>/main.tsx다. 선언의 screens와 같은 key를 쓴다.
+// 화면은 src/screens/<key>/main.tsx다. 선언의 screens와 같은 key를 쓴다. 폰 화면(phone.tsx가 있는 dir)은
+// 건너뛴다: 폰 화면의 build는 release 준비가 한다.
 const screens: string[] = [];
@@ -15,3 +17,8 @@ for (const entry of await readdir(join(root, "src/screens"), {
 })) {
-  if (entry.isDirectory()) screens.push(entry.name);
+  if (
+    entry.isDirectory() &&
+    !existsSync(join(root, "src/screens", entry.name, "phone.tsx"))
+  ) {
+    screens.push(entry.name);
+  }
 }
# lophn.ts (comment only)
@@ -9,2 +9,3 @@ export default defineApp({
   // operation은 화면과 앱 자신이 쓰는 동작이다(agent는 못 본다). command는 agent와 다른 앱이 부르는 의미 단위다.
+  // 폰 화면은 `{ key: "orders", label: "Orders", path: "/screens/orders/index.html", places: ["phone"] }`처럼 `phone` 하나만 둔다(`design-app` skill의 Phone screens).
   screens: [
````
