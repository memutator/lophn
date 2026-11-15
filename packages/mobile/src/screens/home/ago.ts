import { t } from "@lophn/i18n";

/** How long ago, the way the wireframe says it: now, 4m, 2h, 3d. Hermes has no Intl.RelativeTimeFormat to lean on. */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("mobile.home.time.now");
  if (minutes < 60) return t("mobile.home.time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mobile.home.time.hours", { n: hours });
  return t("mobile.home.time.days", { n: Math.floor(hours / 24) });
}
