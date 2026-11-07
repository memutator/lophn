# @lophn/cap-tool 2.0.0

Previous: 1.0.0
Breaking: yes. Move together with `@lophn/declaration` 2.0.0 and `@lophn/app-ui` 2.0.0.

Handlers are registered by name for both operations and commands (the declaration says which a name is).

| Before | After |
| --- | --- |
| `tool("name", run)` | `handle("name", run)` |
| `registeredTools()` | `registeredHandlers()` |
| `ToolRejection(code, message)` | `HandlerRejection(code, message)` |
| `connectTools(app, tools)` | `connectCommands(app, commands)` |
| client `callTool(name, input)` | client `call(name, input)` |
| types `AppToolCaller`, `ToolClient`, `ToolOutcome`, `ToolCallOutput` | `AppCaller`, `CommandClient`, `CallOutcome`, `CallOutput` |

```ts
// before
import { tool } from "@lophn/cap-tool";
tool("order-find", async (input) => { ... });
// after
import { handle } from "@lophn/cap-tool";
handle("order-find", async (input) => { ... });
```

- A command's input is checked against its `inputSchema`. An operation's input is not checked: the handler validates it.
- `connectCommands` reaches only other apps' commands (declared in `app_connections` with `commands: [...]`).
- `currentContext()` also tells the target `kind` and `name`.
- New apps name the registering module `src/handlers.ts` with `registerHandlers()`. Rename an old `src/tools.ts` / `registerTools` the same way and update `main.ts`. The generated `tests/declaration_test.ts` is normally not edited, but for this move it must use `registeredHandlers()` and compare with `operations` plus `commands`; change only that.
