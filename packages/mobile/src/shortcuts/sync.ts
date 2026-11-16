// Keeps the app icons on the phone's home screen (pinned shortcuts) in step with the computers: an icon whose app is
// gone or archived, or whose computer was removed, is turned off; it comes back on when the app is there again. The
// phone keeps no list of its own: Android's pinned ids are the list, and an id names its computer and app.
import { t } from "@lophn/i18n";
import { shortcuts } from "../../modules/lophn-widgets/index.ts";

const PREFIX = "lophn:";

/** Fixed per computer and app, so a pin of the same app finds the icon already there. */
export const shortcutId = (host: string, app: string) =>
  `${PREFIX}${host}:${app}`;

const hostOf = (id: string): string | null => {
  const end = id.indexOf(":", PREFIX.length);
  return id.startsWith(PREFIX) && end > 0 ? id.slice(PREFIX.length, end) : null;
};

/** `apps`: what the computer `host` (named `computer`) has now. The other computers' icons stay as they are. */
export function reconcileShortcuts(
  host: string,
  computer: string,
  apps: readonly string[],
) {
  const has = new Set(apps.map((app) => shortcutId(host, app)));
  const mine = shortcuts.pinnedIds().filter((id) => hostOf(id) === host);
  const gone = mine.filter((id) => !has.has(id));
  const back = mine.filter((id) => has.has(id));
  if (gone.length > 0) {
    shortcuts.disable(gone, t("mobile.shortcut.app-removed", { computer }));
  }
  if (back.length > 0) shortcuts.enable(back);
}

/** `kept`: the computers the phone still has. Icons of any other computer are turned off. */
export function disableRemovedComputers(kept: readonly string[]) {
  const keep = new Set(kept);
  const gone = shortcuts
    .pinnedIds()
    .filter((id) => !keep.has(hostOf(id) ?? ""));
  if (gone.length > 0) {
    shortcuts.disable(gone, t("mobile.shortcut.computer-removed"));
  }
}
