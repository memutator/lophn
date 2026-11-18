# @lophn/app-ui-native 1.7.0

Previous: 1.6.0
Breaking: no. Move together with `@lophn/declaration` 4.10.0 and `@lophn/app-ui` 2.20.0.

The exact peer dependency is now `@lophn/declaration` 4.10.0. Nothing else changed in this package. A phone screen can listen to `data.changed` with `useEvent("lophn", "data.changed", listener)` like any `lophn` event (see the `@lophn/declaration` 4.10.0 note).

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.6.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.7.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
