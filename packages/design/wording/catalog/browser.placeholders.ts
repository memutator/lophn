// catalog/browser.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { browser } from "./browser.ts";

export type BrowserPlaceholders = {
  "browser.button.back": Record<never, never>;
  "browser.button.forward": Record<never, never>;
  "browser.button.inspect": Record<never, never>;
  "browser.button.more": Record<never, never>;
  "browser.button.open-external": Record<never, never>;
  "browser.button.reload": Record<never, never>;
  "browser.label.address": Record<never, never>;
  "browser.label.address-placeholder": Record<never, never>;
  "browser.label.browser": Record<never, never>;
  "browser.label.kind": Record<never, never>;
  "browser.label.menu-browser": Record<never, never>;
  "browser.label.page": Record<never, never>;
  "browser.notice.popup-blocked": Record<never, never>;
};

type Area = typeof browser;
type _SameKeys =
  | Exclude<keyof Area, keyof BrowserPlaceholders>
  | Exclude<keyof BrowserPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
