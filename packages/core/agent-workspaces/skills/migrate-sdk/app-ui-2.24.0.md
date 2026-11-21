# @lophn/app-ui 2.24.0

Previous: 2.23.0
Breaking: no.

Every lophn project now has an `identity`. `Project.identity` from `useProjects()` and `usePlace().workspace.identity` (when `kind` is `"project"`) are `string`, never `null`. lophn also matches projects of the same git repository on the person's computers by itself, so a project's `identity` can change without the person doing anything: it moves to the older id the other computer already had, and the old value goes to `formerIdentities`.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.23.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`).

Key project data by `identity` and keep moving older keys to it when a screen opens:

```tsx
// before
const key = project.identity ?? project.id;
const pairs = projects
  .filter((p) => p.identity !== null)
  .flatMap((p) =>
    [p.id, ...p.formerIdentities].map((old) => ({ id: old, identity: p.identity! })),
  );
// after
const key = project.identity;
const pairs = projects.flatMap((p) =>
  [p.id, ...p.formerIdentities].map((old) => ({ id: old, identity: p.identity })),
);
```

Keep the move: rows written under `id` before this version (projects that had no `identity` then), and rows written under an `identity` that later changed, still need it. If the app does not move them, those rows show under no project.

Nothing else is required of an existing app: code that still writes `identity ?? id` keeps working. If app code or tests build a `Project` or a `PlaceWorkspace` with `kind: "project"` and `identity: null`, give them a `pri_` string instead.

## Instruction diff

Bring the lophn-managed part of the app's `AGENTS.md` in line with the new lines below, key new project data by `identity` alone, and stop treating a `null` identity as "not shared yet".

```diff
# @lophn/app-ui guide.md
@@ -100,7 +100,7 @@ import {
   `id`는 이 컴퓨터에서만 뜻이 있고, `identity`는 내 다른 컴퓨터에서도 같은 project를
-  가리킨다(아직 나누지 않은 project는 `null`). `formerIdentities`는 그 project가 전에
+  가리킨다(모든 project가 갖는다). `formerIdentities`는 그 project가 전에
   가졌던 `identity`다(오래된 것이 앞, 없으면 `[]`).
@@ -259,19 +259,16 @@ function Orders() {
-- key는 `identity ?? id`다. 앱 data는 사람의 다른 컴퓨터로 옮겨질 수 있고, 거기서 같은
+- key는 `identity`다. 앱 data는 사람의 다른 컴퓨터로 옮겨질 수 있고, 거기서 같은
   project를 가리키는 것은 `identity`뿐이다. `id`는 이 컴퓨터에서만 뜻이 있어 다른
-  컴퓨터에서는 주인 없는 줄이 된다.
-- `identity`가 `null`이면 그 project는 아직 다른 컴퓨터와 나누지 않았다(git 저장소인
-  project를 사람이 lophn의 project 상세 "Other computers"에서 켜지 않았다). 그동안은
-  `id`로 붙이고 그 data는 이 컴퓨터에 머문다.
-- 화면이 열릴 때 `useProjects()` 목록에서 `identity`가 있는 project마다 `id`로 붙은 줄을
-  `identity`로 옮긴다(옮길 것이 없으면 아무것도 하지 않는 write operation 하나). 나중에
-  나누게 된 project의 data가 그렇게 따라간다.
-- 옛 `identity`로 붙은 줄도 `identity`로 옮긴다. 사람이 project를 다른 컴퓨터의 project와
-  잇거나 나누면 `identity`가 바뀌고 옛 값은 `formerIdentities`에 남는다. 같은 write
-  operation이 `formerIdentities`의 id로 붙은 줄도 옮긴다. 옮기지 않으면 그 줄은 어느
-  project의 것도 아닌 줄이 된다.
+  컴퓨터에서는 주인 없는 줄이 된다. 모든 project가 `identity`를 갖는다.
+- `identity`는 바뀔 수 있다. lophn은 사람의 다른 컴퓨터에 같은 git 저장소의 project가
+  있으면 묻지 않고 같은 `identity`(먼저 만든 것)로 맞추고, 사람이 project를 잇거나
+  나눠도 바뀐다. 옛 값은 `formerIdentities`에 남는다.
+- 화면이 열릴 때 `useProjects()` 목록의 project마다 `id`와 `formerIdentities`의 id로 붙은
+  줄을 `identity`로 옮긴다(옮길 것이 없으면 아무것도 하지 않는 write operation 하나).
+  예전에 `id`로 붙인 줄과 `identity`가 바뀌기 전에 붙인 줄이 그렇게 따라간다. 옮기지
+  않으면 그 줄은 어느 project의 것도 아닌 줄이 된다.
@@ -291,9 +288,9 @@ function Board() {
-  // 앱 data는 operation 입력으로 project key(identity ?? id)를 넘겨 읽는다.
+  // 앱 data는 operation 입력으로 project key(identity)를 넘겨 읽는다.
   return shown.map((p) => (
-    <ProjectTasks key={p.id} project={p.identity ?? p.id} title={p.title} />
+    <ProjectTasks key={p.id} project={p.identity} title={p.title} />
   ));
# app template AGENTS.md
@@ -35,9 +35,10 @@ Package를 쓴다.
-- project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project의 `identity ?? id`를 key로
-  붙인다. `identity`는 내 다른 컴퓨터에서도 같은 project이고 `id`는 이 컴퓨터에서만 뜻이 있다. `identity`가
-  바뀌면 옛 값이 `formerIdentities`에 남으니 `id`와 `formerIdentities`로 붙은 줄을 `identity`로 옮긴다.
+- project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project의 `identity`를 key로
+  붙인다. `identity`는 내 다른 컴퓨터에서도 같은 project이고 `id`는 이 컴퓨터에서만 뜻이 있다. `identity`는
+  lophn이 다른 컴퓨터의 같은 저장소에 맞추거나 사람이 잇거나 나누면 바뀌고 옛 값이 `formerIdentities`에 남으니
+  `id`와 `formerIdentities`로 붙은 줄을 `identity`로 옮긴다.
   project workspace에서 열리면(`usePlace().workspace`) 그 project만, 그 밖에서는 `useProjects()`로 모든 project를
```
