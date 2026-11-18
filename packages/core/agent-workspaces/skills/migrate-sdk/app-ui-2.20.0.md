# @lophn/app-ui 2.20.0

Previous: 2.19.0
Breaking: no. Move together with `@lophn/declaration` 4.10.0 and, if the app has phone screens, `@lophn/app-ui-native` 1.7.0.

The exact peer dependency is now `@lophn/declaration` 4.10.0. Nothing else changed in this package. See the `@lophn/declaration` 4.10.0 note for the `lophn` event `data.changed` and the event field `across_machines`; a screen receives `data.changed` with `useEvent("lophn", "data.changed", listener)` once the declaration subscribes to it.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.19.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.20.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.10.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
