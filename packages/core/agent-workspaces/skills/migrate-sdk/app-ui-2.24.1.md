# @lophn/app-ui 2.24.1

Previous: 2.24.0
Breaking: no. Move together with `@lophn/declaration` 4.13.0.

The exact dependency is now `@lophn/declaration` 4.13.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.12.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.13.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
