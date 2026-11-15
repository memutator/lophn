// Hermes has no Intl.Segmenter. The protocol's session schema counts a title's graphemes with it when the module loads
// (protocol/lophn-agent/sessions.ts), so the phone gives one before that code runs. It splits by code point: a title
// with joined emoji counts a little long, which only matters next to the 60 and 120 character limits.
const scope = Intl as { Segmenter?: unknown };
scope.Segmenter ??= class {
  segment(text: string) {
    let index = 0;
    return Array.from(text, (segment) => {
      const at = index;
      index += segment.length;
      return { segment, index: at, input: text };
    });
  }
};

// Hermes also has no Intl.RelativeTimeFormat and no Intl.PluralRules. The desktop card model words an age with the first
// (formatRelativeTime) and every count ("4 new declarations") with ICU plurals, which need the second. These are the English
// of what it asks for.
const english = Intl as { RelativeTimeFormat?: unknown; PluralRules?: unknown };

const NEAR: Record<string, Record<number, string>> = {
  second: { 0: "now" },
  day: { "-1": "yesterday", 0: "today", 1: "tomorrow" },
};

// `numeric: "auto"`, the only form formatRelativeTime asks for.
english.RelativeTimeFormat ??= class {
  format(value: number, unit: string): string {
    const word = NEAR[unit]?.[value];
    if (word !== undefined) return word;
    if (value === 0) return `this ${unit}`;
    const many = `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? "" : "s"}`;
    return value < 0 ? `${many} ago` : `in ${many}`;
  }
};

// Cardinal English: one and other.
english.PluralRules ??= class {
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
