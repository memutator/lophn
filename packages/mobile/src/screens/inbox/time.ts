import { t } from "@lophn/i18n";

/** How long ago, in the one or two characters the list has room for: now, 5m, 3h, 2d. */
export function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return t("mobile.inbox.age.now");
  if (minutes < 60) return t("mobile.inbox.age.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mobile.inbox.age.hours", { count: hours });
  return t("mobile.inbox.age.days", { count: Math.floor(hours / 24) });
}
