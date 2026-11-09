# @lophn/app-ui 2.13.0

Previous: 2.12.0
Breaking: no. Move together with `@lophn/declaration` 4.4.0.

No API change. This version only follows `@lophn/declaration` 4.4.0, which lets an app declare `icon: "lucide:<name>"` (see its note).

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.12.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.3.0",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.13.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.4.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.
