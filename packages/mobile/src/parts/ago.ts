import { t } from "@lophn/i18n";

/**
 * How long ago, in the few characters a list's right end or a one-line meta has room for: now, 4m, 2h, 3d. A sentence
 * ("Went live 2 days ago") says it in full with formatRelativeTime instead.
 */
export function ago(at: string | number, now: number = Date.now()): string {
  const time = typeof at === "string" ? Date.parse(at) : at;
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return t("mobile.age.now");
  if (minutes < 60) return t("mobile.age.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mobile.age.hours", { count: hours });
  return t("mobile.age.days", { count: Math.floor(hours / 24) });
}
