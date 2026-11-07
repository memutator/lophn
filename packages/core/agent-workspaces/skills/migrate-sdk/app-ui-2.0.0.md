# @lophn/app-ui 2.0.0

Previous: 1.1.0
Breaking: yes. Move together with `@lophn/declaration` 2.0.0 and `@lophn/cap-tool` 2.0.0.

Screens call operations (declared in `operations`), not tools.

| Before | After |
| --- | --- |
| `ToolButton` with `tool={...}` | `OperationButton` with `operation={...}` |
| `data-tool` attribute | `data-operation` |
| `useTool(tool)` | `useOperation(operation)` |
| `window.lophnApp.callTool(name, input)` | `window.lophnApp.callOperation(name, input)` |
| types `ToolSpec`, `ToolInput`, `ToolState`, `ToolResult`, `UseTool`, `ToolButtonProps` | `OperationSpec`, `OperationInput`, `OperationState`, `OperationResult`, `UseOperation`, `OperationButtonProps` |

```tsx
// before
const archive = declaration.tools.find((tool) => tool.name === "archive-shipped")!;
<ToolButton tool={archive} input={() => ({ orders: selected() })} />;
// after
const archive = declaration.operations.find((op) => op.name === "archive-shipped")!;
<OperationButton operation={archive} input={() => ({ orders: selected() })} />;
```

- A screen can call only operations its declaration lists. A command name or an unknown name is `forbidden`. If a screen used a tool that agents also use, the declaration now has an operation for the screen and a command for agents (see the declaration 2.0.0 note).
- An operation's input is not validated by lophn; the handler checks it.
