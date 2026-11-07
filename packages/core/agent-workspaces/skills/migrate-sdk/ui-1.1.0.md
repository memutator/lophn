# @lophn/ui 1.1.0

Previous: 1.0.0
Breaking: no, unless the app imports `@lophn/wording`.

Depends on `@lophn/i18n` 1.0.0 instead of `@lophn/wording`, which no longer exists. If the app imports `@lophn/wording`, change it to `@lophn/i18n` (`t(key, values?)`, `translator(locale)`) and remove its placeholder generator script and `*.placeholders.ts`. New components are added to this version over time; `npm install` copies the current ones.
