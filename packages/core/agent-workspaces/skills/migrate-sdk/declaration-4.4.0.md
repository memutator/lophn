# @lophn/declaration 4.4.0

Previous: 4.3.0
Breaking: no. Move together with `@lophn/app-ui` 2.13.0.

`icon` can now be a lucide icon name, `"lucide:<name>"`, instead of an image path. `<name>` is a kebab-case name from lucide.dev/icons (`"lucide:folder-kanban"`). lophn draws it in the theme text color on tabs, the activity bar and app lists, so no file is needed. A name that lucide does not have is rejected when the release is prepared. An image path (`"/assets/icon.svg"`) still works as before. A person's icon uploaded in App details still wins over both.

```ts
// before: a hand-written image file in the source
export default defineApp({
  name: "board",
  // ...
  icon: "/assets/icon.svg",
});

// after: no file needed
export default defineApp({
  name: "board",
  // ...
  icon: "lucide:folder-kanban",
});
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.3.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.4.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`), and `@lophn/app-ui` to `2.13.0` in both places. Nothing else is required of an existing app. If the app has an `icon` image that is only a plain glyph (a folder, a chart), consider switching to a lucide name and deleting the file.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, replace the lophn-managed sentence about `icon` in the `lophn.ts` line with the new one below, and change the guide path example to `4.4.0`. If the app edited that part, keep the app's own additions.
- From now on, when an app needs an icon, pick a lucide name (`"lucide:<name>"`) first. Hand-write an SVG file only when the icon is a picture that a lucide glyph cannot be.

```diff
# app template AGENTS.md
@@ -91,5 +91,6 @@
-  바깥 명령)는 `public`이 아니면 이 앱 workspace에서만 보인다. 앱 icon이 필요하면 `icon`
-  (bundle 안 경로, svg·png·webp, 64 KiB 이하)을 선언한다. lophn이 탭과 앱 목록에
-  그 이미지를 보인다.
+  바깥 명령)는 `public`이 아니면 이 앱 workspace에서만 보인다. 앱 icon이 필요하면 `icon`을
+  선언한다. lucide 이름(`"lucide:folder-kanban"`, 파일 없이 theme 색을 따른다)을 먼저 고르고,
+  그림이 따로 필요할 때만 bundle 안 경로(svg·png·webp, 64 KiB 이하)를 쓴다. lophn이 탭과
+  앱 목록에 그것을 보인다.

# design-app skill
@@ -159,3 +159,6 @@
-- An app may declare `icon` (an image in the source, see the `@lophn/declaration`
-  guide). lophn shows it on tabs, the activity bar and app lists. A person can
-  also upload one in App details; theirs wins.
+- An app may declare `icon`: a lucide icon name such as `"lucide:folder-kanban"`
+  (pick one that fits the app; no file needed, and it follows the theme color),
+  or an image in the source such as `"/assets/icon.svg"` (see the
+  `@lophn/declaration` guide). Prefer the lucide name; do not hand-write an SVG
+  for a plain glyph.

# @lophn/declaration guide.md
@@ -55,5 +55,10 @@
-- `icon` — 앱 icon 이미지의 bundle 안 경로다(`"/assets/icon.svg"`). `.svg`, `.png`,
-  `.webp`만 받고 64 KiB 이하여야 한다. ...
+- `icon` — 앱 icon이다. 두 꼴 가운데 하나를 쓴다. 없으면 기본 모양이다.
+  - `"lucide:<이름>"` — lucide icon 이름이다(`"lucide:folder-kanban"`). 이름은 lucide.dev/icons의
+    kebab-case 이름이고, lophn이 theme 글자색으로 그린다. 파일이 필요 없다. 없는 이름은 release
+    준비가 거절한다. 앱 agent는 icon을 직접 그리기 전에 이것을 먼저 고른다.
+  - bundle 안 이미지 파일의 경로(`"/assets/icon.svg"`) — `.svg`, `.png`, `.webp`만 받고 64 KiB 이하여야 한다. ...
```
