# @lophn/app-ui 2.11.0

Previous: 2.10.0
Breaking: no.

Adds `useProjects()`. It reads every lophn project (archived ones too) once when the screen opens and returns `{state, reload}`. Each project is `{id, name, title, purpose, status}`. Folder paths are not included; the folders of the project the screen is open in are still in `usePlace().workspace.folders`. Call `reload()` to pick up changes made while the screen is open.

```tsx
// before: the app kept its own list of projects
// after
import { usePlace, useProjects } from "@lophn/app-ui";

const { workspace } = usePlace();
const { state } = useProjects();
const only = workspace?.kind === "project" ? workspace.id : null;
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.10.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.11.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app. If the app keeps its own "project" records for per-project data (tasks, schedules), consider moving that data onto lophn project ids as described below.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, add the lophn-managed line about per-project data below the `useCommand` lines. Keep the app's own additions.
- Do not build project create/rename/list screens inside an app. Key per-project app data by the lophn project `id`. In a project workspace show only that project; elsewhere group all projects with `useProjects()`.

```diff
# app template AGENTS.md
@@ -33,2 +33,5 @@ Package를 쓴다.
   단축키는 `lophn.ts`의 `keys`에 선언하고 같은 `id`로 `useCommand`를 건다. 화면이 맞추지 않은 단축키는 shell이 돈다.
+- project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project `id`를 key로 붙인다.
+  project workspace에서 열리면(`usePlace().workspace`) 그 project만, 그 밖에서는 `useProjects()`로 모든 project를
+  묶어 보인다. `@lophn/app-ui` guide의 "project에 붙는 앱"을 따른다.
# @lophn/app-ui guide.md
@@ -7,4 +7,4 @@
-`usePlace`, 일이 도는 동안 page를 살려 두는 `useKeepAlive`, 선언한 key의 handler를 거는
-`useCommand`다. 화면은
+`usePlace`, lophn project 목록을 읽는 `useProjects`, 일이 도는 동안 page를 살려 두는
+`useKeepAlive`, 선언한 key의 handler를 거는 `useCommand`다. 화면은
@@ -95,2 +95,10 @@ import {
+- `useProjects(app?)` — lophn의 모든 project(보관 포함)를 화면이 열릴 때 한 번 읽는다.
+  `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", projects}`·
+  `{status: "failed", code}`다. project는 `{id, name, title, purpose, status}`다.
+  `title`은 사람에게 보일 이름, `name`은 agent 주소에 쓰는 slug, `status`는
+  `active`·`archived`다. 폴더 path는 주지 않는다(지금 열린 project의 폴더만
+  `usePlace().workspace.folders`). 화면이 열린 동안 바뀐 것은 저절로 오지 않으니
+  `reload()`로 다시 읽는다(예: 머리 줄의 새로 고침). 읽는 사이 목록이 바뀌면
+  `conflict`, 앱 view 밖이면 `unavailable`이다. 쓰는 법은 아래 "project에 붙는 앱".
@@ -221,2 +229,31 @@ function Orders() {
+## project에 붙는 앱
+
+작업·일정·문서처럼 "project별"로 나뉘는 data를 다루는 앱(Gantt, 할 일, 회의록)은 project를
+따로 만들지 않는다. lophn project가 project다. 앱 안에 project 만들기·이름 바꾸기·목록 화면을
+두지 않고, 앱 data에는 lophn project `id`를 key로 붙인다(이름과 제목은 바뀌므로 key로 쓰지
+않는다). project 만들기와 고치기는 사람이 lophn에서 한다.
+
+- 화면이 project workspace에서 열렸으면(`usePlace().workspace?.kind === "project"`) 그
+  project의 data만 보인다. 사람에게 project를 고르게 하지 않는다.
+- 그 밖의 자리(Home, 앱 workspace, 앱 전용 창, 전역 float)에서는 모든 project를 project별로
+  묶어 보인다. 묶음 제목은 `useProjects()`의 `title`이다. 보관한 project는 접거나 뺀다.
+- 앱 data에 있는데 목록에 없는 project id는 무시한다(보이지 않는 project다).
```
