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

type Kind = "string" | "number" | "plural" | "date";
type ValueFor<T> = T extends "plural" | "number" ? number
  : T extends "date" ? Date
  : string;
type AppValues<P> = { [N in keyof P]: ValueFor<P[N]> };
type AppArgs<P> = [keyof P] extends [never] ? [values?: Record<string, never>]
  : [values: AppValues<P>];

// 앱의 en catalog용 `t`다. placeholder 종류는 앱이 catalog에서 생성한
// PlaceholderKinds(generate.ts의 render)를 type으로 준다. key 없음·placeholder 불일치는 compile error다.
export function createTranslator<
  C extends Readonly<Record<string, string>>,
  P extends { [K in keyof C]: Record<string, Kind> },
>(
  catalog: C,
): <K extends keyof C & string>(key: K, ...args: AppArgs<P[K]>) => string {
  const formats = new Map<string, IntlMessageFormat>();
  return (key, ...[values]) => {
    let format = formats.get(key);
    if (!format) {
      format = new IntlMessageFormat(catalog[key], "en");
      formats.set(key, format);
    }
    return String(format.format((values ?? {}) as Record<string, never>));
  };
}
