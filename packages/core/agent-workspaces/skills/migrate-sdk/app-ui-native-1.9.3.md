# @lophn/app-ui-native 1.9.3

Previous: 1.9.2
Breaking: no. Move together with `@lophn/declaration` 4.12.0.

The exact dependency is now `@lophn/declaration` 4.12.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.2",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.11.0",
// package.json, after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.3",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.12.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
