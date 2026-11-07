# @lophn/declaration 2.0.0

Previous: 1.0.0
Breaking: yes. Move together with `@lophn/cap-tool` 2.0.0 and `@lophn/app-ui` 2.0.0.

`tools[]` is split in two lists. Screens call operations; agents, other apps, jobs and flows call commands. An operation is hidden from agents and other apps (calling it is `denied`).

Before:

```ts
tools: [
  { name: "order-list", title: "List orders", description: "...", inputSchema: null,
    outputSchema: {...}, effect: "read", public: false, domain: "orders" },
],
app_connections: [{ app: "shop", tools: ["order-find"], reason: "..." }],
```

After:

```ts
// What this app's own screens call: {name, title, effect} only.
operations: [{ name: "order-list", title: "List orders", effect: "read" }],
// What agents / other apps call: a small, meaningful action with its input schema.
commands: [
  { name: "order-find", description: "...", inputSchema: {...}, effect: "read",
    public: false, domain: "orders" },
],
app_connections: [{ app: "shop", commands: ["order-find"], reason: "..." }],
```

- Names are shared: one name, one list, one handler. A tool that both a screen and an agent used becomes an operation plus a differently named command.
- `outputSchema` is gone.
- `domain` is still required on commands in this version. `declaration` 3.0.0 removes it again; if you migrate on to 3.0.0 or later, do not add it.
- Update `sdk_dependencies`, `package.json`, and the code in `@lophn/cap-tool` 2.0.0 and `@lophn/app-ui` 2.0.0 notes.
