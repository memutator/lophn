# @lophn/app-ui 2.18.0

Previous: 2.17.0
Breaking: no. Move together with `@lophn/declaration` 4.9.0.

The exact peer dependency is now `@lophn/declaration` 4.9.0. Nothing else changed in this package. See the `@lophn/declaration` 4.9.0 note for the declaration change (`sync_to`).

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.17.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.8.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.18.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
