# @lophn/app-ui 2.4.0

Previous: 2.3.0
Breaking: no

Adds `usePlace()`: `{ place, params, workspace }` of the screen, fixed when it opens.

- `place` is `"tab" | "panel" | "card" | "sidebar" | "tray"`, or `null` outside an app view. It is one of the screen's declared `places`.
- `params` is what the screen's declared `params` schema accepted (`{}` when none). lophn already validated it.
- `workspace` is `{ kind: "project" | "home" | "app", id, folders }`, or `null` where unknown.

```tsx
const { place, params } = usePlace();
return place === "card" ? <Summary /> : <Table status={String(params.status ?? "open")} />;
```

Use it to choose what to show per place; lay out by CSS container query, not by place. Nothing is required of an existing app.
