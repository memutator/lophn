# @lophn/app-ui 2.14.0

Previous: 2.13.0
Breaking: no. Move together with `@lophn/declaration` 4.5.0.

Adds `useEvent(source, event, listener)`. A screen receives an app event while it is mounted. The app must declare the same `{source, event}` in `subscriptions` of `lophn.ts` (see the `@lophn/declaration` 4.5.0 note); lophn only sends the events the screen's release declared. Events are not stored: whatever happened while the screen was closed does not come, so read the current value through an operation first and then follow events.

```tsx
// before: the screen polls
// after
import { useEvent } from "@lophn/app-ui";

useEvent<{ percent: number }>("masup", "usage.limit", (e) => setPercent(e.percent));
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.13.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.4.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- To keep a screen current with another app's fact, declare a subscription and use `useEvent` instead of polling. Do not rely on events alone for the first value.

```diff
# @lophn/app-ui guide.md
@@ -8,3 +8,3 @@
 `usePlace`, lophn project 목록을 읽는 `useProjects`, 일이 도는 동안 page를 살려 두는
-`useKeepAlive`, 선언한 key의 handler를 거는 `useCommand`다. 화면은
+`useKeepAlive`, 선언한 key의 handler를 거는 `useCommand`, 앱 event를 받는 `useEvent`다. 화면은
 operation만 부르고, 호출은 앱 view의 `lophnApp.callOperation` 하나로만 한다.
@@ -104,2 +104,10 @@ import {
   `conflict`, 앱 view 밖이면 `unavailable`이다. 쓰는 법은 아래 "project에 붙는 앱".
+- `useEvent(source, event, listener)` — 다른 앱이나 lophn이 낸 event를 화면이 mount된 동안 받는다. `source`는 발행 앱의
+  slug이거나 lophn의 `"lophn"`이다. 앱의 선언 `subscriptions`에 같은 `{source, event}`가 있어야 온다(`@lophn/declaration`).
+  `listener(payload)`는 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다. event는 일이 일어난 뒤의 알림이라 한 번
+  오고 저장되지 않는다. 화면이 닫힌 동안의 것은 오지 않으니 **처음 값은 발행 앱의 read로 읽고** event로 고친다(화면은
+  operation만 부르므로 앱이 그 값을 operation으로도 내놓는다). 앱 view 밖이면 아무 일도 없다.
+  ```tsx
+  useEvent<{ percent: number }>("masup", "usage.limit", (e) => setPercent(e.percent));
+  ```
 - `useKeepAlive(active, app?)` — `active`인 동안 사람이 이 화면이 있는 workspace를
@@ -118,3 +126,3 @@ import {
     `lophnApp.setKeepAlive(active, key?)`를 직접 부를 때도 같은 key로 켜고 끈다.
-- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `Project`, `ProjectsBridge`, `ProjectsState`, `UseProjects`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
+- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `EventBridge`, `Project`, `ProjectsBridge`, `ProjectsState`, `UseProjects`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
   `OperationResult`, `OperationButtonProps`, `UseOperation`,
```
