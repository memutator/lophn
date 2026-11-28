# @lophn/app-ui 2.26.1

Previous: 2.26.0
Breaking: no. Move together with `@lophn/declaration` 6.1.0.

The exact dependency is now `@lophn/declaration` 6.1.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.26.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/6.0.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.26.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/6.1.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
