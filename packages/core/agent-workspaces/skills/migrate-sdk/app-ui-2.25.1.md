# @lophn/app-ui 2.25.1

Previous: 2.25.0
Breaking: no. Move together with `@lophn/declaration` 5.2.0.

The exact dependency is now `@lophn/declaration` 5.2.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.25.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.25.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.2.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
