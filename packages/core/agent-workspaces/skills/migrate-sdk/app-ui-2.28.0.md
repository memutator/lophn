# @lophn/app-ui 2.28.0

Previous: 2.27.0
Breaking: no.

`useWorktrees` now refreshes on the app event `("lophn", "worktree.changed")` instead of a private bridge callback. The event only reaches apps that declare it in `subscriptions`, so an app that wants live worktree updates must declare it. The event payload type `WorktreeChangedEvent` and the name `WORKTREE_CHANGED_EVENT` are exported too.

```ts
// lophn.ts, before
subscriptions: [],
// lophn.ts, after
subscriptions: [{ source: "lophn", event: "worktree.changed" }],
```

```tsx
import { useEvent, type WorktreeChangedEvent } from "@lophn/app-ui";

useEvent<WorktreeChangedEvent>("lophn", "worktree.changed", (change) => {
  if (change.reason === "removed") setSelected(null);
});
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.27.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.28.0",
```

Update `sdk_dependencies` in `lophn.ts` to match. If the app uses `useWorktrees` and does not add the subscription, the list still loads but no longer refreshes by itself; call `reload()` or add the subscription. Apps that do not use worktrees need no change.

## Instruction diff

When an app shows worktrees, declare `{ source: "lophn", event: "worktree.changed" }` in `subscriptions` so `useWorktrees` stays current.

```diff
# @lophn/app-ui guide.md
@@ -114,7 +114,10 @@
-  core가 worktree 변경·상태 알림을 내면 자동으로 다시 읽는다. 앱 view 밖이면 `unavailable`이다.
+  앱 선언의 `subscriptions`에 `{ source: "lophn", event: "worktree.changed" }`를 적으면 worktree가 만들어지거나 지워지거나
+  브랜치·git 상태가 바뀔 때 저절로 다시 읽는다(적지 않으면 `reload()`로 읽는다). 같은 알림을 `useEvent("lophn", "worktree.changed", …)`로
+  직접 받을 수도 있다: payload는 `{projectId, projectIdentity, worktreeId, reason, at}`이고 `reason`은
+  `created`·`removed`·`updated`·`status`·`branch`다. 앱 view 밖이면 `unavailable`이다.
```
