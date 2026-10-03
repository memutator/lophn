import { IntlMessageFormat } from "intl-messageformat";
import { en, type MessageKey } from "./en.ts";
import type { HasPlaceholders, ValuesOf } from "./placeholders.ts";

export type { MessageKey } from "./en.ts";

// placeholder가 없는 key는 values를 받지 않는다. 있는 key는 빠지거나 남으면 compile error다.
type Args<K extends MessageKey> = HasPlaceholders<K> extends true
  ? [values: ValuesOf<K>]
  : [values?: Record<string, never>];

const cache = new Map<string, IntlMessageFormat>();

function formatter(key: MessageKey, locale: string): IntlMessageFormat {
  const id = `${locale}\u0000${key}`;
  const found = cache.get(id);
  if (found) return found;
  const made = new IntlMessageFormat(en[key], locale);
  cache.set(id, made);
  return made;
}

export function t<K extends MessageKey>(
  key: K,
  ...[values]: Args<K>
): string {
  return String(formatter(key, "en").format(values ?? {}));
}
