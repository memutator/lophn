# @lophn/app-ui 1.1.0

Previous: 1.0.0
Breaking: no, unless the app imports `@lophn/wording`.

Depends on `@lophn/i18n` 1.0.0 and `@lophn/ui` 1.1.0 (1.0.0 depended on `@lophn/wording`, which no longer exists). The text of its components follows `<html data-lophn-locale>`, which lophn sets.

If the app imports `@lophn/wording`, change it to `@lophn/i18n` (`t(key, values?)`, `translator(locale)`), and delete the placeholder generator script (`npm run wording`) and `*.placeholders.ts` files. An app's own screen text is written inline in the screen code.
