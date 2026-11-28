# @lophn/app-ui 2.27.1

Previous: 2.27.0
Breaking: no. Move together with `@lophn/declaration` 6.2.0.

The exact dependency is now `@lophn/declaration` 6.2.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.27.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/6.1.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.27.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/6.2.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.

- In the app's `AGENTS.md`, change the guide path example to `6.2.0`. If the app edited that part, keep the app's own additions.
- The skill sharing instructions changed in `@lophn/declaration` 6.2.0: read its note for the new deploy step and the instruction diff.
