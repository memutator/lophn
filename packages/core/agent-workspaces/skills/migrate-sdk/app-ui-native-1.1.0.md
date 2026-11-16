# @lophn/app-ui-native 1.1.0

Previous: 1.0.0
Breaking: no. Move together with `@lophn/declaration` 4.7.0.

The exact dependency is now `@lophn/declaration` 4.7.0. Nothing else changed in this package. See the `@lophn/declaration` 4.7.0 note for the declaration change (`widgets` and `phone.use`).

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.0.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.1.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.7.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
