# @lophn/app-ui 2.16.0

Previous: 2.15.0
Breaking: no. Move together with `@lophn/declaration` 4.7.0.

The exact peer dependency is now `@lophn/declaration` 4.7.0. Nothing else changed in this package. See the `@lophn/declaration` 4.7.0 note for the declaration change (`widgets` and `phone.use`).

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.15.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.16.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.7.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; existing supported SDK versions remain supported.
