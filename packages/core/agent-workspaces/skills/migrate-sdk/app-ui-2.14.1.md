# @lophn/app-ui 2.14.1

Previous: 2.14.0
Breaking: no. Move together with `@lophn/declaration` 4.5.1.

Updates the exact peer dependency to `@lophn/declaration` 4.5.1. Screen APIs are unchanged. See that version's migration note for the declaration validation fix and the CLI spelling instructions.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.1",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app by this package; existing supported SDK versions remain supported.
