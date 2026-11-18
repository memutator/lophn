# @lophn/app-ui 2.21.0

Previous: 2.20.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.8.0 if the app has phone screens.

A project now carries `formerIdentities`: the `identity` values it had before, oldest first, never including the current `identity`. `useProjects()` gives `{id, identity, formerIdentities, name, title, purpose, status}`, and `usePlace().workspace` has `formerIdentities` when `kind` is `"project"`. A project's `identity` changes when the person links a project to the same project on another computer, or separates it from one; rows the app keyed by the old `identity` then belong to no project until the app moves them.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.20.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.21.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`).

If the app moves rows keyed by `id` to `identity` when a screen opens (the `@lophn/app-ui` 2.19.0 note), move rows keyed by a former identity the same way:

```tsx
// before
const pairs = projects
  .filter((p) => p.identity !== null)
  .map((p) => ({ id: p.id, identity: p.identity! }));
// after: every old key of the project moves to its identity
const pairs = projects
  .filter((p) => p.identity !== null)
  .flatMap((p) =>
    [p.id, ...p.formerIdentities].map((old) => ({ id: old, identity: p.identity! })),
  );
```

The write operation stays the same: for each pair it rewrites the project key of every row from `id` to `identity` and does nothing when there is nothing to move. Also treat a key that matches a project's `formerIdentities` as that project when reading.

If the app does not move these rows, nothing breaks, but rows keyed by an old identity show under no project after the person links or separates that project. An app that keeps no data per project needs nothing.

If app code or tests build a `Project` or a `PlaceWorkspace` with `kind: "project"`, add `formerIdentities` (an array, `[]` when there is none).

## Instruction diff

Bring the lophn-managed part of the app's `AGENTS.md` in line with the new lines below, and move rows keyed by `formerIdentities` together with rows keyed by `id` in new code.

```diff
# @lophn/app-ui guide.md
@@ -93,3 +93,3 @@ import {
   - `workspace`는 `{kind: "project" | "home" | "app", id, folders}`이고 project면
-    `identity`도 있다(`useProjects()`의 `identity`와 같은 값). 앱 sidebar
+    `identity`와 `formerIdentities`도 있다(`useProjects()`의 같은 칸과 같은 값). 앱 sidebar
     panel처럼 모든 workspace에 나오는 화면이 이걸 보고 맞춘다. `folders`는
@@ -99,5 +99,7 @@ import {
   `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", projects}`·
-  `{status: "failed", code}`다. project는 `{id, identity, name, title, purpose, status}`다.
+  `{status: "failed", code}`다. project는
+  `{id, identity, formerIdentities, name, title, purpose, status}`다.
   `id`는 이 컴퓨터에서만 뜻이 있고, `identity`는 내 다른 컴퓨터에서도 같은 project를
-  가리킨다(아직 나누지 않은 project는 `null`).
+  가리킨다(아직 나누지 않은 project는 `null`). `formerIdentities`는 그 project가 전에
+  가졌던 `identity`다(오래된 것이 앞, 없으면 `[]`).
   `title`은 사람에게 보일 이름, `name`은 agent 주소에 쓰는 slug, `status`는
@@ -260,2 +262,6 @@ function Orders() {
   나누게 된 project의 data가 그렇게 따라간다.
+- 옛 `identity`로 붙은 줄도 `identity`로 옮긴다. 사람이 project를 다른 컴퓨터의 project와
+  잇거나 나누면 `identity`가 바뀌고 옛 값은 `formerIdentities`에 남는다. 같은 write
+  operation이 `formerIdentities`의 id로 붙은 줄도 옮긴다. 옮기지 않으면 그 줄은 어느
+  project의 것도 아닌 줄이 된다.
 
@@ -265,4 +271,4 @@ function Orders() {
   묶어 보인다. 묶음 제목은 `useProjects()`의 `title`이다. 보관한 project는 접거나 뺀다.
-- 앱 data에 있는데 목록의 어느 project의 `identity`·`id`와도 맞지 않는 key는 무시한다(이
-  컴퓨터에 없거나 보이지 않는 project다).
+- 앱 data에 있는데 목록의 어느 project의 `identity`·`formerIdentities`·`id`와도 맞지 않는
+  key는 무시한다(이 컴퓨터에 없거나 보이지 않는 project다).
 
# app template AGENTS.md
@@ -38,3 +38,4 @@ Package를 쓴다.
 - project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project의 `identity ?? id`를 key로
-  붙인다. `identity`는 내 다른 컴퓨터에서도 같은 project이고 `id`는 이 컴퓨터에서만 뜻이 있다.
+  붙인다. `identity`는 내 다른 컴퓨터에서도 같은 project이고 `id`는 이 컴퓨터에서만 뜻이 있다. `identity`가
+  바뀌면 옛 값이 `formerIdentities`에 남으니 `id`와 `formerIdentities`로 붙은 줄을 `identity`로 옮긴다.
   project workspace에서 열리면(`usePlace().workspace`) 그 project만, 그 밖에서는 `useProjects()`로 모든 project를
```
