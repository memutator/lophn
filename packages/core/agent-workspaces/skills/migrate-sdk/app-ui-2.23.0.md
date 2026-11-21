# @lophn/app-ui 2.23.0

Previous: 2.22.1
Breaking: no. Move together with `@lophn/declaration` 4.12.0.

New hook `useMachines()` reads the person's computers and the one this screen's backend runs on. It returns `{ state, reload }`; `state` is `{ status: "loading" }`, `{ status: "ready", machines }` or `{ status: "failed", code }`. Each machine is `{ id, name, status, current, always_on }`: `id` is the `mch_` id you pass to `connectCommands(app, commands, { on: id })` in the backend, `status` is `online | offline | connecting | update` (the same names as `MachineOption`, so the list goes to `MachineSelector` as it is), `current` marks the computer the backend runs on, `always_on` says that computer is marked to stay running (`null` when lophn has no record from it yet). No permission is needed and nothing goes in `lophn.ts`. It pins `@lophn/declaration` 4.12.0.

```tsx
// After: pick a computer, then pass its id to an operation whose handler uses connectCommands(..., { on })
import { useMachines } from "@lophn/app-ui";
import { MachineSelector } from "@lophn/ui/input";

const { state } = useMachines();
if (state.status === "ready") {
  <MachineSelector machines={state.machines} value={picked} onValueChange={setPicked} ariaLabel="Computer" />;
}
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.22.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.11.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.23.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.12.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app. Replace hand-made "which computer is this" detection (reading lophn's data folder such as `machine.json`, the hostname, `/proc/<pid>/environ`, an environment variable) with the roster API below. Those values are not given by lophn, differ per computer and break on the next release.

## Instruction diff

The SDK guide describes `useMachines` and a section "컴퓨터를 고르는 화면". When a screen must show or use another computer, list the computers with `useMachines()`, let the person pick with `MachineSelector`, and call that computer from the backend with `connectCommands(..., { on: id })`; do not read lophn's data folder or guess from the hostname.

```diff
# @lophn/app-ui guide.md
@@ -7,3 +7,3 @@
 조작을 lophn 탭 머리 줄에 올리는 `useTabHead`, 화면이 열린 자리·인자·workspace를 읽는
-`usePlace`, lophn project 목록을 읽는 `useProjects`, 일이 도는 동안 page를 살려 두는
+`usePlace`, lophn project 목록을 읽는 `useProjects`, 사람의 컴퓨터 명단을 읽는 `useMachines`, 일이 도는 동안 page를 살려 두는
 `useKeepAlive`, 선언한 key의 handler를 거는 `useCommand`, 앱 event를 받는 `useEvent`다. 화면은
@@ -109,2 +109,10 @@ import {
   `conflict`, 앱 view 밖이면 `unavailable`이다. 쓰는 법은 아래 "project에 붙는 앱".
+- `useMachines(app?)` — 사람의 컴퓨터(폰 제외)와 이 화면의 backend가 도는 컴퓨터를 화면이 열릴 때 한 번 읽는다.
+  `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", machines}`·`{status: "failed", code}`다.
+  machine은 `{id, name, status, current, always_on}`이다. `id`는 `mch_` id로 `connectCommands(…, { on })`에
+  그대로 쓴다. `status`는 `online`·`offline`·`connecting`·`update`(`@lophn/ui`의 `MachineOption`과 같다)라
+  `machines`를 `MachineSelector`에 그대로 넘긴다. `current`는 이 화면의 backend가 도는 컴퓨터 하나다(다른 컴퓨터의
+  창에 그려진 화면이면 그 backend의 컴퓨터다). `always_on`은 그 컴퓨터가 "늘 켜 둠"으로 표시됐는지이고 그 컴퓨터의
+  기록이 아직 없으면 `null`이다. 켜짐 상태는 저절로 오지 않으니 `reload()`로 다시 읽는다. 앱 view 밖이면 `unavailable`이다.
+  허락이 필요 없고 선언에 적을 것도 없다. 쓰는 법은 아래 "컴퓨터를 고르는 화면".
 - `useEvent(source, event, listener)` — 다른 앱이나 lophn이 낸 event를 화면이 mount된 동안 받는다. `source`는 발행 앱의
@@ -131,3 +139,3 @@ import {
     `lophnApp.setKeepAlive(active, key?)`를 직접 부를 때도 같은 key로 켜고 끈다.
-- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `EventBridge`, `Project`, `ProjectsBridge`, `ProjectsState`, `UseProjects`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
+- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `EventBridge`, `Project`, `ProjectsBridge`, `ProjectsState`, `UseProjects`, `Machine`, `MachinesBridge`, `MachinesState`, `UseMachines`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
   `OperationResult`, `OperationButtonProps`, `UseOperation`,
@@ -292,2 +300,36 @@ function Board() {
 
+## 컴퓨터를 고르는 화면
+
+사람은 컴퓨터를 여러 대 잇는다. 한 앱 release는 그 모든 컴퓨터가 따르고 각 컴퓨터에서 같은 선언과 code로 돈다. 앱이 "내가 어느 컴퓨터에서
+도나", "다른 컴퓨터는 무엇이 있나"를 알려면 `useMachines()`(화면)나 `@lophn/cap-tool`의 `machines()`(backend)를 읽는다. 앱이 lophn의 data
+root를 읽거나, hostname·`/proc`·환경 변수로 컴퓨터를 알아내려 하지 않는다. 그런 길은 컴퓨터마다 달라 어긋나고 lophn이 주는 값이 아니다.
+
+다른 컴퓨터의 data를 지금 보려면: 화면이 `MachineSelector`로 컴퓨터를 고르고, 고른 `id`를 operation 입력으로 넘기고, 그 operation의
+handler가 `connectCommands(앱 slug, [command], { on: id })`로 그 컴퓨터의 같은 앱 command를 부른다(`@lophn/cap-tool`의 "다른 기계의 앱 부르기").
+`current`인 컴퓨터는 `on`에 줄 수 없다(`invalid_input`). 그 컴퓨터는 이 컴퓨터의 handler가 바로 읽는다. 그 컴퓨터가 꺼져 있으면 부르는 것이
+`unavailable`이다.
+
+```tsx
+import { useState } from "react";
+import { useMachines, useOperation } from "@lophn/app-ui";
+import { MachineSelector } from "@lophn/ui/input";
+
+function ServerUsage() {
+  const { state } = useMachines();
+  const [picked, setPicked] = useState<string | null>(null);
+  const usage = useOperation("usage.read"); // handler가 picked 컴퓨터면 connectCommands로 건너간다
+  if (state.status !== "ready") return <Loading />;
+  const machine = picked ?? state.machines.find((m) => m.current)?.id ?? null;
+  return (
+    <MachineSelector
+      machines={state.machines}
+      value={machine}
+      onValueChange={setPicked}
+      ariaLabel="Computer"
+    />
+    // 그리고 machine을 입력으로 usage를 부른다. current면 on 없이 읽고 아니면 { on: machine }으로 부른다.
+  );
+}
+```
+
 ## version 정책
```
