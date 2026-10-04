// en.ts에서 생성한다. 직접 고치지 않고 `deno run -A generate.ts --check`로 맞춘다.
import type { MessageKey } from "./en.ts";

export type PlaceholderKinds = {
  "common.notification.body": Record<never, never>;
  "common.notification.title": Record<never, never>;
  "contexts.view.baseline": Record<never, never>;
  "contexts.view.reference": Record<never, never>;
  "contexts.view.follow-changes": Record<never, never>;
  "document.diff.identical": Record<never, never>;
  "settings.models.for-decisions": Record<never, never>;
  "settings.models.for-summaries": Record<never, never>;
  "common.activity.agent": Record<never, never>;
  "common.activity.app": Record<never, never>;
  "common.error.load-failed": {
    target: "string";
  };
  "common.button.reload": Record<never, never>;
  "common.stale.label": {
    age: "string";
  };
  "common.author.label": {
    author: "string";
  };
  "common.heading.column-unit": {
    header: "string";
    unit: "string";
  };
  "common.button.copy-id": Record<never, never>;
  "common.button.copy-code": Record<never, never>;
  "common.copy.failed": Record<never, never>;
  "common.label.on-this-page": Record<never, never>;
};

type ValueFor<T> = T extends "plural" | "number" ? number
  : T extends "date" ? Date
  : string;

export type ValuesOf<K extends MessageKey> = {
  [P in keyof PlaceholderKinds[K]]: ValueFor<PlaceholderKinds[K][P]>;
};

export type HasPlaceholders<K extends MessageKey> = [
  keyof PlaceholderKinds[K],
] extends [never] ? false
  : true;

type _SameKeys =
  | Exclude<MessageKey, keyof PlaceholderKinds>
  | Exclude<keyof PlaceholderKinds, MessageKey>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
