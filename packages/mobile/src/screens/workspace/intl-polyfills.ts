// Hermes has no Intl.RelativeTimeFormat (formatRelativeTime, the desktop's "2 hours ago", builds on it) and no
// Intl.PluralRules (every ICU plural in the catalog needs it: "Every # days"). These cover what lophn asks for: English
// only. They belong next to the Segmenter polyfill in src/app/intl.ts once the frame owns them; they live here so the
// workspace screens run without touching the frame.
type Unit = "year" | "month" | "day" | "hour" | "minute" | "second";

const AUTO: Partial<Record<Unit, Record<number, string>>> = {
  year: { 0: "this year", 1: "next year", [-1]: "last year" },
  month: { 0: "this month", 1: "next month", [-1]: "last month" },
  day: { 0: "today", 1: "tomorrow", [-1]: "yesterday" },
  hour: { 0: "this hour" },
  minute: { 0: "this minute" },
  second: { 0: "now" },
};

const scope = Intl as { RelativeTimeFormat?: unknown };
scope.RelativeTimeFormat ??= class {
  format(value: number, unit: Unit): string {
    const said = AUTO[unit]?.[value];
    if (said !== undefined) return said;
    const n = Math.abs(value);
    const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return value < 0 ? `${label} ago` : `in ${label}`;
  }
};

// English cardinals say one for 1 and other for the rest; ordinals (1st, 2nd) are not used by any catalog sentence.
const plurals = Intl as { PluralRules?: unknown };
plurals.PluralRules ??= class {
  static supportedLocalesOf = (locales: string | string[]) => [locales].flat();
  select(value: number): "one" | "other" {
    return value === 1 ? "one" : "other";
  }
  resolvedOptions() {
    return { locale: "en" };
  }
};
