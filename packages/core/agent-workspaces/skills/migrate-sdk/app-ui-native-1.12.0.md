# @lophn/app-ui-native 1.12.0

Previous: 1.11.1
Breaking: no. Move together with `@lophn/declaration` 6.0.0.

The exact dependency is now `@lophn/declaration` 6.0.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.11.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.2.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.12.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/6.0.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app beyond the `@lophn/declaration` 6.0.0 sync policy review.
