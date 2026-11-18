# @lophn/app-ui 2.22.0

Previous: 2.21.0
Breaking: no. Move together with `@lophn/declaration` 4.11.0 and, if the app has phone screens, `@lophn/app-ui-native` 1.9.0.

The exact peer dependency is now `@lophn/declaration` 4.11.0. Nothing else changed in this package. See the `@lophn/declaration` 4.11.0 note for the subscription field `machine`; a screen does not receive events of another computer, so `useEvent` is unchanged.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.21.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.10.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.22.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.11.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
