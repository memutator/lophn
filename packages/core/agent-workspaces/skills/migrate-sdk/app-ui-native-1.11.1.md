# @lophn/app-ui-native 1.11.1

Previous: 1.11.0
Breaking: no. Move together with `@lophn/declaration` 5.2.0.

The exact dependency is now `@lophn/declaration` 5.2.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.11.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
// package.json, after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.11.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.2.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
