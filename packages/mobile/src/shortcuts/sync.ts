// Keeps the app icons on the phone's home screen (pinned shortcuts) in step with the computers: an icon whose app is
// gone or archived, or whose computer was removed, is turned off; it comes back on when the app is there again. The
// phone keeps no list of its own: Android's pinned ids are the list, and an id names its computer and app.
import { t } from "@lophn/i18n";
import { useEffect } from "react";
import { AppState } from "react-native";
import { appPhoneScreens } from "../../../protocol/apps/phone.ts";
import { readRoute } from "../../../shell/renderer/desktop/connection/core-read.ts";
import { shortcuts } from "../../modules/lophn-widgets/index.ts";
import type { ComputerData, Computers } from "../data/mod.ts";

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

// What `StateChanged` says about an app going, coming back, or losing its phone screen with a release.
const WATCHED = new Set(["apps", "releases"]);

/**
 * Reconciles the icons of every computer that has some, not only the one on screen: when its connection comes up, when
 * it says an app or a release changed, and when the phone app comes to the front. Mount once at the app root.
 */
export function useShortcutSync(computers: Computers<ComputerData>) {
  useEffect(() => {
    const check = (host: string) => {
      const link = computers.link(host);
      if (link?.state().status !== "connected") return;
      if (!shortcuts.pinnedIds().some((id) => hostOf(id) === host)) return;
      void readRoute(link.data.core, appPhoneScreens, {}).then(
        (read) => {
          if (!read.ok) return;
          const name = computers.get().computers.find((one) => one.key === host)?.name ?? "";
          reconcileShortcuts(host, name, read.value.screens.map((one) => one.app));
        },
        () => {},
      );
    };
    const listening = new Map<string, { link: unknown; connected: boolean; off: () => void }>();
    const follow = () => {
      const items = computers.get().computers;
      for (const item of items) {
        const link = computers.link(item.key);
        const was = listening.get(item.key);
        const connected = item.status === "connected";
        if (link === undefined) continue;
        if (was?.link !== link) {
          was?.off();
          const off = link.data.client.subscribe({ types: ["StateChanged"] }, (message) => {
            if (
              message.kind === "event" &&
              message.event.type === "StateChanged" &&
              message.event.payload.changes.some((one) => WATCHED.has(one.name))
            ) {
              check(item.key);
            }
          });
          listening.set(item.key, { link, connected, off });
        } else {
          listening.set(item.key, { ...was, connected });
        }
        if (connected && was?.connected !== true) check(item.key);
      }
      const keys = new Set(items.map((one) => one.key));
      for (const [key, one] of listening) {
        if (keys.has(key)) continue;
        one.off();
        listening.delete(key);
      }
    };
    follow();
    const off = computers.subscribe(follow);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") for (const key of listening.keys()) check(key);
    });
    return () => {
      app.remove();
      off();
      for (const one of listening.values()) one.off();
    };
  }, [computers]);
}
