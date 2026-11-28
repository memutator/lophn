# @lophn/agent 1.21.0

Previous: 1.20.0
Breaking: no

Adds the `worktree_remove` variant to `GateCall` / `AskedCall` (and `"worktree_remove"` to `PermissionCategory`) in the ACP approval subject union so custom approval UIs can display agent-initiated git worktree removal requests.

```ts
switch (subject.kind) {
  case "worktree_remove":
    // { project, worktree, path, branch, provenance: "managed" | "adopted", dirty_count, untracked_count, ahead, has_submodules, force, stop_sessions, delete_branch }
    break;
}
```

Nothing is required of an existing app unless it switches exhaustively over `AskedCall["kind"]` or `PermissionCategory`.
