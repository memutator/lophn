# @lophn/app-ui 2.27.0

Previous: 2.26.1
Breaking: no.

`@lophn/app-ui` 2.27.0 adds the read-only `useWorktrees(project, app?)` hook (and `Worktree`, `WorktreeGitStatus`, `WorktreeStatus`, `WorktreeProvenance`, `WorktreePresence`, `WorktreesBridge`, `WorktreesState`, `UseWorktrees` types) to inspect a project's git worktrees and live git status via `lophnApp.projects.worktrees` / `onWorktreesChanged` without exposing filesystem paths.

```tsx
import { usePlace, useWorktrees } from "@lophn/app-ui";

function WorktreeList() {
  const { workspace } = usePlace();
  const project = workspace?.kind === "project" ? workspace.id : null;
  const { state, reload } = useWorktrees(project);
  if (state.status !== "ready") return null;
  return (
    <ul>
      {state.worktrees.map((wt) => (
        <li key={wt.id}>
          {wt.label} ({wt.branch ?? "detached"})
        </li>
      ))}
    </ul>
  );
}
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.26.1",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.27.0",
```

Update `sdk_dependencies` in `lophn.ts` to match. Existing apps require no changes.

## Instruction diff

Follow the updated `@lophn/app-ui` guide when an app needs read-only visibility into a project's git worktrees: use `useWorktrees(project)` instead of trying to run git commands or inspect filesystem paths.

```diff
# @lophn/app-ui guide.md
@@ -112,3 +112,8 @@
   `conflict`, 앱 view 밖이면 `unavailable`이다. 쓰는 법은 아래 "project에 붙는 앱".
+- `useWorktrees(project, app?)` — project 하나의 git worktree 목록과 상태를 읽기 전용으로 읽는다.
+  `project`는 `prj_` id, `pri_` identity, 또는 project 이름이다(`null`·`undefined`면 빈 목록).
+  `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", worktrees}`·`{status: "failed", code}`다.
+  각 항목은 `{id, project_id, label, branch, base_ref, provenance, status, created_at, updated_at, git}`이며 파일시스템 경로(`path` 등)는 싣지 않는다.
+  core가 worktree 변경·상태 알림을 내면 자동으로 다시 읽는다. 앱 view 밖이면 `unavailable`이다.
```
