# @lophn/app-ui-native 1.4.0

Previous: 1.3.0
Breaking: no. Move together with `@lophn/declaration` 4.9.0.

The exact dependency is now `@lophn/declaration` 4.9.0. Nothing else changed in this package. See the `@lophn/declaration` 4.9.0 note for the declaration change (`sync_to`).

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.3.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.8.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.4.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
