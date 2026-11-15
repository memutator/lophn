// Hermes has no Intl.PluralRules, so every `{count, plural, …}` message (Read 2 files, Answered 1 question) fails to
// format. The catalog is English, whose rules are these. Belongs next to the Segmenter in app/intl.ts; it sits here
// until the frame takes it, and loads with this screen's module at app start (app/routes.tsx).
const scope = Intl as { PluralRules?: unknown };
scope.PluralRules ??= class {
  readonly type: "cardinal" | "ordinal";
  constructor(_locales?: unknown, options?: { type?: "cardinal" | "ordinal" }) {
    this.type = options?.type ?? "cardinal";
  }
  select(value: number): string {
    if (this.type === "cardinal") return value === 1 ? "one" : "other";
    const ten = value % 10;
    const hundred = value % 100;
    if (ten === 1 && hundred !== 11) return "one";
    if (ten === 2 && hundred !== 12) return "two";
    if (ten === 3 && hundred !== 13) return "few";
    return "other";
  }
  resolvedOptions() {
    return { locale: "en", type: this.type };
  }
  static supportedLocalesOf(locales: string | string[]) {
    return Array.isArray(locales) ? locales : [locales];
  }
};
