# @lophn/app-ui 2.19.0

Previous: 2.18.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.6.0 if the app has phone screens.

A project now carries `identity`: the ID that names the same project on all of the person's computers. `useProjects()` gives `{id, identity, name, title, purpose, status}`, and `usePlace().workspace` has `identity` when `kind` is `"project"` (`PlaceWorkspace` is now a union; Home and app workspaces are unchanged). `id` still means this computer only. `identity` is `null` while a git project is not yet shared with other computers (the person turns that on in the project's details, "Other computers").

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.18.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.19.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`).

Key project data by `identity ?? id` instead of `id`:

```tsx
// before
<ProjectTasks project={p.id} />
const key = workspace?.kind === "project" ? workspace.id : null;
// after
<ProjectTasks project={p.identity ?? p.id} />
const key = workspace?.kind === "project" ? (workspace.identity ?? workspace.id) : null;
```

If the app already stores rows keyed by a project `id`, move them:

1. Add one write operation, for example `projects.adopt` with input `{ pairs: { id: string; identity: string }[] }`. For each pair it rewrites the project key of every row from `id` to `identity` (in every table and field that holds a project key) and does nothing when there is nothing to move, so calling it again is harmless.
2. When a screen opens and `useProjects()` is ready, call it once with every project whose `identity` is not `null`.
3. Read and write with `identity ?? id` from then on. Ignore keys that match neither an `identity` nor an `id` in the list (that project is on another computer or not visible).

The same call later moves the data of a project the person shares afterwards. If the app does not move its rows, nothing breaks on this computer, but rows synced to the person's other computers keep a key that means nothing there, so that data shows under no project. An app that keeps no data per project needs nothing.

If app code or tests build a `PlaceWorkspace` with `kind: "project"`, add `identity` (a string or `null`).

## Instruction diff

Bring the lophn-managed part of the app's `AGENTS.md` in line with the new lines below, and stop keying project data by `id` alone in new code.

```diff
# @lophn/app-ui guide.md
@@ -92,3 +92,4 @@ import {
     열렸으면 `{}`다. 값을 쓰기 전에 앱이 다시 검사할 필요는 없다.
-  - `workspace`는 `{kind: "project" | "home" | "app", id, folders}`다. 앱 sidebar
+  - `workspace`는 `{kind: "project" | "home" | "app", id, folders}`이고 project면
+    `identity`도 있다(`useProjects()`의 `identity`와 같은 값). 앱 sidebar
     panel처럼 모든 workspace에 나오는 화면이 이걸 보고 맞춘다. `folders`는
@@ -98,3 +99,5 @@ import {
   `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", projects}`·
-  `{status: "failed", code}`다. project는 `{id, name, title, purpose, status}`다.
+  `{status: "failed", code}`다. project는 `{id, identity, name, title, purpose, status}`다.
+  `id`는 이 컴퓨터에서만 뜻이 있고, `identity`는 내 다른 컴퓨터에서도 같은 project를
+  가리킨다(아직 나누지 않은 project는 `null`).
   `title`은 사람에게 보일 이름, `name`은 agent 주소에 쓰는 slug, `status`는
@@ -245,5 +248,15 @@ function Orders() {
 따로 만들지 않는다. lophn project가 project다. 앱 안에 project 만들기·이름 바꾸기·목록 화면을
-두지 않고, 앱 data에는 lophn project `id`를 key로 붙인다(이름과 제목은 바뀌므로 key로 쓰지
+두지 않고, 앱 data에는 lophn project를 key로 붙인다(이름과 제목은 바뀌므로 key로 쓰지
 않는다). project 만들기와 고치기는 사람이 lophn에서 한다.
 
+- key는 `identity ?? id`다. 앱 data는 사람의 다른 컴퓨터로 옮겨질 수 있고, 거기서 같은
+  project를 가리키는 것은 `identity`뿐이다. `id`는 이 컴퓨터에서만 뜻이 있어 다른
+  컴퓨터에서는 주인 없는 줄이 된다.
+- `identity`가 `null`이면 그 project는 아직 다른 컴퓨터와 나누지 않았다(git 저장소인
+  project를 사람이 lophn의 project 상세 "Other computers"에서 켜지 않았다). 그동안은
+  `id`로 붙이고 그 data는 이 컴퓨터에 머문다.
+- 화면이 열릴 때 `useProjects()` 목록에서 `identity`가 있는 project마다 `id`로 붙은 줄을
+  `identity`로 옮긴다(옮길 것이 없으면 아무것도 하지 않는 write operation 하나). 나중에
+  나누게 된 project의 data가 그렇게 따라간다.
+
 - 화면이 project workspace에서 열렸으면(`usePlace().workspace?.kind === "project"`) 그
@@ -252,3 +265,4 @@ function Orders() {
   묶어 보인다. 묶음 제목은 `useProjects()`의 `title`이다. 보관한 project는 접거나 뺀다.
-- 앱 data에 있는데 목록에 없는 project id는 무시한다(보이지 않는 project다).
+- 앱 data에 있는데 목록의 어느 project의 `identity`·`id`와도 맞지 않는 key는 무시한다(이
+  컴퓨터에 없거나 보이지 않는 project다).
 
@@ -265,4 +279,6 @@ function Board() {
   );
-  // 앱 data는 operation 입력으로 project id를 넘겨 읽는다.
-  return shown.map((p) => <ProjectTasks key={p.id} project={p.id} title={p.title} />);
+  // 앱 data는 operation 입력으로 project key(identity ?? id)를 넘겨 읽는다.
+  return shown.map((p) => (
+    <ProjectTasks key={p.id} project={p.identity ?? p.id} title={p.title} />
+  ));
 }
# app template AGENTS.md
@@ -37,3 +37,4 @@ Package를 쓴다.
   command를 따로 내놓고, 구독 앱은 켜질 때 그것을 한 번 읽는다.
-- project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project `id`를 key로 붙인다.
+- project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project의 `identity ?? id`를 key로
+  붙인다. `identity`는 내 다른 컴퓨터에서도 같은 project이고 `id`는 이 컴퓨터에서만 뜻이 있다.
   project workspace에서 열리면(`usePlace().workspace`) 그 project만, 그 밖에서는 `useProjects()`로 모든 project를
```
