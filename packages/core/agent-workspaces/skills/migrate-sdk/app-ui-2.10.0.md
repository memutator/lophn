# @lophn/app-ui 2.10.0

Previous: 2.9.0
Breaking: no. Move together with `@lophn/declaration` 4.3.0.

Adds `useCommand(id, handler, options?)`. It attaches a handler to a key declared in `keys` of `lophn.ts` (`id` is that key's `id`). While the screen is mounted, pressing a declared key runs the handler and lophn does not see that key. `options.when` is checked on each press: when it returns false the handler does not run and the key goes on to lophn's own shortcuts. The handler and `when` are read at press time, so passing new closures on each render is fine.

```tsx
// before: the save shortcut does nothing
// after
import { useCommand } from "@lophn/app-ui";

useCommand("save", () => void save(), { when: () => dirty });
```

The `declaration` side needs `keys` in `lophn.ts`, which is in `@lophn/declaration` 4.3.0.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.9.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.2.0",

// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.10.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.3.0",
```

Change the same two versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, the lophn-managed part lists `useCommand` among the bridge components, and the guide path is `4.3.0`. Keep the app's own additions.
- Shortcuts go in `keys` and their handlers in `useCommand` with the same `id`. A key the screen does not handle goes to lophn.

```diff
# app template AGENTS.md
@@ -31,3 +31,4 @@ Package를 쓴다.
   목록이다(export마다 "언제 쓰나" 한 줄). 앱
-  bridge component(OperationButton, useOperation, AppErrorBoundary, useTabHead)는 `@lophn/app-ui`다.
+  bridge component(OperationButton, useOperation, AppErrorBoundary, useTabHead)와 key handler(useCommand)는 `@lophn/app-ui`다.
+  단축키는 `lophn.ts`의 `keys`에 선언하고 같은 `id`로 `useCommand`를 건다. 화면이 맞추지 않은 단축키는 shell이 돈다.
 - lophn은 탭, panel(dock·float), sidebar, tray, 세션 카드 어디에서나 화면 위에 자기 머리 줄을 그린다.
# @lophn/app-ui guide.md
@@ -7,3 +7,4 @@
 조작을 lophn 탭 머리 줄에 올리는 `useTabHead`, 화면이 열린 자리·인자·workspace를 읽는
-`usePlace`, 일이 도는 동안 page를 살려 두는 `useKeepAlive`다. 화면은
+`usePlace`, 일이 도는 동안 page를 살려 두는 `useKeepAlive`, 선언한 key의 handler를 거는
+`useCommand`다. 화면은
 operation만 부르고, 호출은 앱 view의 `lophnApp.callOperation` 하나로만 한다.
@@ -76,2 +77,9 @@ import {
     바뀔 때만 다시 올린다.
+- `useCommand(id, handler, options?)` — 선언의 key `id`(`declaration`의 `keys`)에 handler를 건다. 화면이
+  mount된 동안만 산다. `options.when`은 `() => boolean`이다. 거짓을 돌려주면 handler가 돌지 않고 그 key는
+  shell로 넘어간다(없으면 늘 참이다). handler와 `when`은 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다.
+  앱 view 밖이면 아무 일도 없다. 선언에 없는 `id`는 아무도 부르지 않는다.
+  ```tsx
+  useCommand("save", () => void save(), { when: () => dirty });
+  ```
 - `usePlace()` — 이 화면이 열릴 때 정해진 `{place, params, workspace}`다. 읽기만
@@ -101,3 +109,3 @@ import {
     `lophnApp.setKeepAlive(active, key?)`를 직접 부를 때도 같은 key로 켜고 끈다.
-- type: `KeepAliveBridge`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
+- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
   `OperationResult`, `OperationButtonProps`, `UseOperation`,
```
