# @lophn/app-ui-native 1.6.0

Previous: 1.5.0
Breaking: no. Move together with `@lophn/app-ui` 2.19.0.

`PlaceWorkspace` (from `usePlace()`) now carries `identity` when `kind` is `"project"`, the same as `@lophn/app-ui` 2.19.0. On a phone screen `workspace` is still `null`, so phone code reads nothing new.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.5.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.6.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app. Key project data the way the `@lophn/app-ui` 2.19.0 note says (`identity ?? id`). If app code or tests build a `PlaceWorkspace` with `kind: "project"`, add `identity` (a string or `null`).
