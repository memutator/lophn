// Hermes has no Intl.RelativeTimeFormat, and the desktop card model (`cardOf`) formats its age with it even though Home
// does not show that age. English only, as the catalog is. Belongs next to the Segmenter in app/intl.ts, which this task
// does not own.
const scope = Intl as { RelativeTimeFormat?: unknown };
scope.RelativeTimeFormat ??= class {
  format(value: number, unit: string) {
    const n = Math.abs(value);
    if (n === 0) return unit === "second" ? "now" : `this ${unit}`;
    const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return value < 0 ? `${text} ago` : `in ${text}`;
  }
};
