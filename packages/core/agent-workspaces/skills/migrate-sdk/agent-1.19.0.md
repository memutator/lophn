# @lophn/agent 1.19.0

Previous: 1.18.0
Breaking: no

Adds two new `GateCall` / `AskedCall` variants (`project_command` and `project_command_definition`) to the ACP approval subject union so custom approval UIs can inspect project command run and definition-write requests.

```ts
// Exhaustive switch on subject.kind now receives two additional kinds:
switch (subject.kind) {
  case "project_command":
    // { project, command_id, name, command, cwd, env_keys }
    break;
  case "project_command_definition":
    // { project, action: "add" | "update" | "remove", before, after }
    break;
}
```

Nothing is required of an existing app unless it switches exhaustively over `AskedCall["kind"]`.
