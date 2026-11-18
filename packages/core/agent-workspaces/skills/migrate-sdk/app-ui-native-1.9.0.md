# @lophn/app-ui-native 1.9.0

Previous: 1.8.0
Breaking: no. Move together with `@lophn/declaration` 4.11.0 and `@lophn/app-ui` 2.22.0.

The exact peer dependency is now `@lophn/declaration` 4.11.0. Nothing else changed in this package. See the `@lophn/declaration` 4.11.0 note for the subscription field `machine`; a phone screen does not receive events of another computer.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.8.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
