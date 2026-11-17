// Keeps the app icons on the phone's home screen (pinned shortcuts) in step with the computers: an icon whose app is
// gone or archived, or whose computer was removed, is turned off; it comes back on when the app is there again; its name
// and picture follow the app's. The phone keeps no list of its own: Android's pinned icons are the list, an id names its
// computer and app, and an icon carries the key of what its picture was drawn from.
import { t } from "@lophn/i18n";
import { createElement, useEffect, useState } from "react";
import { AppState } from "react-native";
import { appPhoneScreens } from "../../../protocol/apps/phone.ts";
import { readRoute } from "../../../shell/renderer/desktop/connection/core-read.ts";
import { shortcuts } from "../../modules/lophn-widgets/index.ts";
import { savedLists } from "../data/lists.ts";
import type { ComputerData, Computers } from "../data/mod.ts";
import { openUrl } from "../open/target.ts";
import { type Drawn, drawnOf, IconPicture, pictureKey } from "./picture.tsx";

const PREFIX = "lophn:";

/** Fixed per computer and app, so a pin of the same app finds the icon already there. */
export const shortcutId = (host: string, app: string) =>
  `${PREFIX}${host}:${app}`;

const hostOf = (id: string): string | null => {
  const end = id.indexOf(":", PREFIX.length);
  return id.startsWith(PREFIX) && end > 0 ? id.slice(PREFIX.length, end) : null;
};

const appOf = (id: string) => id.slice(id.indexOf(":", PREFIX.length) + 1);

/** An icon whose picture is drawn again: drawing needs the app's view tree, so the sync component draws it. */
type Redraw = { id: string; label: string; url: string; drawn: Drawn };

/**
 * `apps`: what the computer `host` (named `computer`) has now, app id to name. The other computers' icons stay as they
 * are. A name that changed is set here; the icons whose picture changed are returned to be drawn again.
 */
function reconcileShortcuts(
  host: string,
  computer: string,
  apps: ReadonlyMap<string, string>,
): Redraw[] {
  const mine = shortcuts.pinned().filter((one) => hostOf(one.id) === host);
  const gone = mine.filter((one) => !apps.has(appOf(one.id)));
  const back = mine.filter((one) => apps.has(appOf(one.id)));
  if (gone.length > 0) {
    shortcuts.disable(
      gone.map((one) => one.id),
      t("mobile.shortcut.app-removed", { computer }),
    );
  }
  if (back.length > 0) shortcuts.enable(back.map((one) => one.id));
  const renamed = [];
  const redraw: Redraw[] = [];
  for (const one of back) {
    const app = appOf(one.id);
    const label = apps.get(app) ?? one.label;
    const url = openUrl({ kind: "app", host, app });
    // The picture is checked against the icon the phone kept of the app; one never read here leaves it as it is.
    const icon = savedLists.icon(host, "app", app);
    const drawn = icon === undefined ? null : drawnOf(app, label, icon);
    if (drawn !== null && pictureKey(drawn) !== one.picture) {
      redraw.push({ id: one.id, label, url, drawn });
    } else if (label !== one.label) {
      renamed.push({ id: one.id, label, iconPng: "", url, picture: one.picture });
    }
  }
  if (renamed.length > 0) shortcuts.update(renamed);
  return redraw;
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
 * it says an app or a release changed, when the phone keeps a new app icon, and when the phone app comes to the front.
 * Mount once at the app root, under the UI provider: it draws the pictures off the screen.
 */
export function ShortcutSync({ computers }: { computers: Computers<ComputerData> }) {
  const [redraws, setRedraws] = useState<ReadonlyMap<string, Redraw>>(new Map());
  useEffect(() => {
    const check = (host: string) => {
      const link = computers.link(host);
      if (link?.state().status !== "connected") return;
      if (!shortcuts.pinnedIds().some((id) => hostOf(id) === host)) return;
      void readRoute(link.data.core, appPhoneScreens, {}).then(
        (read) => {
          if (!read.ok) return;
          const name = computers.get().computers.find((one) => one.key === host)?.name ?? "";
          const apps = new Map(read.value.screens.map((one) => [one.app, one.app_name]));
          const redraw = reconcileShortcuts(host, name, apps);
          if (redraw.length === 0) return;
          setRedraws((current) => {
            const next = new Map(current);
            for (const one of redraw) {
              // One already drawing the same picture goes on.
              const was = current.get(one.id);
              if (was === undefined || pictureKey(was.drawn) !== pictureKey(one.drawn)) next.set(one.id, one);
            }
            return next;
          });
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
    const offSaved = savedLists.subscribe(() => {
      for (const key of listening.keys()) check(key);
    });
    return () => {
      offSaved();
      app.remove();
      off();
      for (const one of listening.values()) one.off();
    };
  }, [computers]);
  const drew = (one: Redraw, png: string) => {
    setRedraws((current) => {
      if (current.get(one.id) !== one) return current;
      const next = new Map(current);
      next.delete(one.id);
      return next;
    });
    // Nothing drew (the phone app went to the back): the next check tries again.
    if (png === "") return;
    shortcuts.update([{ id: one.id, label: one.label, iconPng: png, url: one.url, picture: pictureKey(one.drawn) }]);
  };
  return [...redraws.values()].map((one) =>
    createElement(IconPicture, {
      key: `${one.id}:${pictureKey(one.drawn)}`,
      drawn: one.drawn,
      onDone: (png: string) => drew(one, png),
    }),
  );
}
