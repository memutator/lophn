// catalog/browser.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { browser } from "./browser.ts";

export type BrowserPlaceholders = {
  "browser.button.back": Record<never, never>;
  "browser.button.bookmark-add": Record<never, never>;
  "browser.button.bookmark-edit": Record<never, never>;
  "browser.button.bookmarks": Record<never, never>;
  "browser.button.forward": Record<never, never>;
  "browser.button.inspect": Record<never, never>;
  "browser.button.more": Record<never, never>;
  "browser.button.open-external": Record<never, never>;
  "browser.button.reload": Record<never, never>;
  "browser.error.bookmark-limit": Record<never, never>;
  "browser.heading.palette-bookmarks": Record<never, never>;
  "browser.label.address": Record<never, never>;
  "browser.label.address-placeholder": Record<never, never>;
  "browser.label.browser": Record<never, never>;
  "browser.label.kind": Record<never, never>;
  "browser.label.menu-browser": Record<never, never>;
  "browser.label.page": Record<never, never>;
  "browser.notice.no-bookmarks": Record<never, never>;
  "browser.notice.popup-blocked": Record<never, never>;
  "settings.button.bookmark-edit": Record<never, never>;
  "settings.button.bookmark-remove": Record<never, never>;
  "settings.button.bookmark-save": Record<never, never>;
  "settings.button.browser-clear": Record<never, never>;
  "settings.button.browser-clear-confirm": Record<never, never>;
  "settings.error.bookmark-duplicate": Record<never, never>;
  "settings.error.bookmark-failed": Record<never, never>;
  "settings.error.bookmark-title": Record<never, never>;
  "settings.error.bookmark-url": Record<never, never>;
  "settings.error.bookmarks-corrupt": Record<never, never>;
  "settings.error.bookmarks-load-failed": Record<never, never>;
  "settings.error.browser-clear-failed": Record<never, never>;
  "settings.heading.bookmarks": Record<never, never>;
  "settings.heading.browser-data": Record<never, never>;
  "settings.label.bookmark-title": Record<never, never>;
  "settings.label.bookmark-url": Record<never, never>;
  "settings.label.tab-browser": Record<never, never>;
  "settings.note.browser-clear": Record<never, never>;
  "settings.note.browser-clear-confirm": Record<never, never>;
  "settings.notice.bookmarks-empty": Record<never, never>;
  "settings.notice.browser-cleared": Record<never, never>;
  "settings.title.browser-clear": Record<never, never>;
};

type Area = typeof browser;
type _SameKeys =
  | Exclude<keyof Area, keyof BrowserPlaceholders>
  | Exclude<keyof BrowserPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
