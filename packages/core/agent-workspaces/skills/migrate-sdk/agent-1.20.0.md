# @lophn/agent 1.20.0

Previous: 1.19.0
Breaking: no

Adds the `workflow_run` variant to `GateCall` / `AskedCall` (and `"workflow_run"` to `PermissionCategory`) in the ACP approval subject union so custom approval UIs can display agent-initiated one-off workflow runs, per-instance workflow overrides, and per-instance flow code patches.

```ts
switch (subject.kind) {
  case "workflow_run":
    // { project, mode: "one_off" | "override" | "override_code", workflow, execution: "agent" | "flow", lines }
    break;
}
```

Nothing is required of an existing app unless it switches exhaustively over `AskedCall["kind"]` or `PermissionCategory`.
