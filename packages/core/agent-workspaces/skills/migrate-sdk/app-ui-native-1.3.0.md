# @lophn/app-ui-native 1.3.0

Previous: 1.2.0
Breaking: no. Move together with `@lophn/ui-native` 0.2.0.

The exact peer is now `@lophn/ui-native` 0.2.0. Nothing else changed in this package. See the `@lophn/ui-native` 0.2.0 note for the kit change (`Input` is named by its `Field` label).

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.2.0",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.1.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.3.0",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.2.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
