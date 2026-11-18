# @lophn/app-ui-native 1.8.0

Previous: 1.7.0
Breaking: no. Move together with `@lophn/app-ui` 2.21.0.

`PlaceWorkspace` (from `usePlace()`) now carries `formerIdentities` when `kind` is `"project"`, the same as `@lophn/app-ui` 2.21.0. On a phone screen `workspace` is still `null`, so phone code reads nothing new.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.7.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.8.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app. Move project rows the way the `@lophn/app-ui` 2.21.0 note says (rows keyed by `formerIdentities` move to `identity`). If app code or tests build a `PlaceWorkspace` with `kind: "project"`, add `formerIdentities` (an array).
