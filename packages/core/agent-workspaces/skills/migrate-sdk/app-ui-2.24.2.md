# @lophn/app-ui 2.24.2

Previous: 2.24.1
Breaking: no. Move together with `@lophn/declaration` 5.0.0.

The exact dependency is now `@lophn/declaration` 5.0.0. Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.13.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.2",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.0.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Read the `@lophn/declaration` 5.0.0 note: an app with `sync_to` must replace it with `sync` in its next release.
