// Hermes has no Intl.RelativeTimeFormat and no Intl.PluralRules. The desktop card model words a request's age with the first
// (formatRelativeTime) and its counts ("4 new declarations") with ICU plurals, which need the second. These are the English
// of what it asks for. The frame gives the same kind of stand-in for Intl.Segmenter in app/intl.ts; these move there when
// another screen needs them.
const scope = Intl as { RelativeTimeFormat?: unknown; PluralRules?: unknown };

const NEAR: Record<string, Record<number, string>> = {
  second: { 0: "now" },
  day: { "-1": "yesterday", 0: "today", 1: "tomorrow" },
};

// `numeric: "auto"`, the only form formatRelativeTime asks for.
scope.RelativeTimeFormat ??= class {
  format(value: number, unit: string): string {
    const word = NEAR[unit]?.[value];
    if (word !== undefined) return word;
    if (value === 0) return `this ${unit}`;
    const many = `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? "" : "s"}`;
    return value < 0 ? `${many} ago` : `in ${many}`;
  }
};

// Cardinal English: one and other.
scope.PluralRules ??= class {
  static supportedLocalesOf(locales: string | string[]) {
    return ([] as string[]).concat(locales);
  }
  select(value: number): string {
    return value === 1 ? "one" : "other";
  }
  resolvedOptions() {
    return { locale: "en" };
  }
};
