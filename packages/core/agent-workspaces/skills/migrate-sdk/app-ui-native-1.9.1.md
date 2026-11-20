# @lophn/app-ui-native 1.9.1

Previous: 1.9.0
Breaking: no. Move together with `@lophn/ui-native` 0.3.1.

The exact peer dependency is now `@lophn/ui-native` 0.3.1. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.0",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.0",
// package.json, after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.1",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.1",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
