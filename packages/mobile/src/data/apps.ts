// The user apps of the computer on screen that have a phone screen (`apps/phone_screens`) in their live release or in the
// preview running now, read again on reconnect and when a release or an app process changes. A screen whose params are
// required is left out: the phone has nowhere to give them.
import { useEffect, useMemo } from "react";
import type { z } from "zod";
import { appPhoneScreens } from "../../../protocol/apps/phone.ts";
import {
  readRoute,
  readsOf,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import { forgetApps, forgetComputers } from "../apps/bundle.ts";
import { bundleFiles } from "../apps/bundle-files.ts";
import { disableRemovedComputers, reconcileShortcuts } from "../shortcuts/sync.ts";
import { useComputers } from "./hooks.tsx";

// The kept lists and icons of each computer: the phone's light store, read by the same screens.
export * from "./lists.ts";

type Read = z.output<typeof appPhoneScreens.output>;
export type PhoneScreen = Read["screens"][number];
export type PreviewScreen = Read["previews"][number]["screens"][number];

/** A preview of the app that runs on the computer now. Its screens open from the app's menu (Preview from lophn), or from
 * the app's line when the app has no live phone screen. */
export interface PhonePreview {
  readonly bundle_hash: string;
  readonly process_nonce: string;
  readonly screens: readonly [PreviewScreen, ...PreviewScreen[]];
}

export interface PhoneApp {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  /** The live release's phone screens: the first is the app's screen, the rest open from its menu. Empty when only the
   * running preview has a phone screen (an app's first phone screen, not released yet); then the app is its preview. */
  readonly screens: readonly PhoneScreen[];
  /** The live release's process runs on the computer now. */
  readonly running: boolean;
  /** Null when no preview with a phone screen runs. */
  readonly preview: PhonePreview | null;
}

const needsParams = (screen: Pick<PhoneScreen, "params">) =>
  (screen.params?.required?.length ?? 0) > 0;

function previewOf(previews: Read["previews"], app: string): PhonePreview | null {
  const found = previews.find((one) => one.app === app);
  const screens = found?.screens.filter((screen) => !needsParams(screen)) ?? [];
  if (found === undefined || screens.length === 0) return null;
  return {
    bundle_hash: found.bundle_hash,
    process_nonce: found.process_nonce,
    screens: screens as [PreviewScreen, ...PreviewScreen[]],
  };
}

export function phoneAppsOf(
  screens: readonly PhoneScreen[],
  previews: Read["previews"],
): PhoneApp[] {
  const byApp = new Map<string, PhoneScreen[]>();
  for (const screen of screens) {
    if (needsParams(screen)) continue;
    byApp.set(screen.app, [...(byApp.get(screen.app) ?? []), screen]);
  }
  const live: PhoneApp[] = [...byApp.values()].map((list) => {
    const first = list[0]!;
    return {
      app: first.app,
      name: first.app_name,
      icon: first.icon,
      screens: list,
      running: first.running,
      preview: previewOf(previews, first.app),
    };
  });
  const onlyPreview = previews.flatMap((one): PhoneApp[] => {
    const preview = byApp.has(one.app) ? null : previewOf(previews, one.app);
    return preview === null
      ? []
      : [{ app: one.app, name: one.app_name, icon: one.icon, screens: [], running: false, preview }];
  });
  return [...live, ...onlyPreview];
}

/** An app that shows on the phone only as its running preview (no live release with a phone screen). */
export const previewOnly = (app: PhoneApp): boolean => app.screens.length === 0;

// The last list read from each computer this run. A screen opened while its computer is away has no read of its own
// yet; it still knows the app's name from here.
const lastRead = new Map<string, Read>();

export interface PhoneApps {
  readonly apps: readonly PhoneApp[];
  readonly state: "loading" | "ready" | "failed";
  reload(): void;
}

/** The computer on screen's apps with a phone screen. Also drops cached screens of apps and computers that are gone. */
export function usePhoneApps(): PhoneApps {
  const { ready, current, computers } = useComputers();
  // The list carries the computer it was read from, so a list still on screen after a switch is not taken as the new one's.
  const { loaded, reload } = useFollowedRead(
    async (core) => {
      const read = await readRoute(core, appPhoneScreens, {});
      return read.ok
        ? { ok: true, value: { computer: current, read: read.value } }
        : read;
    },
    readsOf(appPhoneScreens, {}),
    `phone_screens:${current}`,
  );
  const value = loaded.state === "ready" ? loaded.value : null;
  const read = value?.computer === current ? (value?.read ?? null) : null;
  const shown = read ?? (current === null ? null : (lastRead.get(current) ?? null));
  useEffect(() => {
    if (value === null || value.computer === null) return;
    lastRead.set(value.computer, value.read);
    forgetApps(
      bundleFiles(),
      value.computer,
      [...value.read.screens, ...value.read.previews].map((one) => one.app),
    );
    reconcileShortcuts(value.computer, computers.find((one) => one.key === value.computer)?.name ?? "", value.read.screens.map((one) => one.app));
  }, [value]);
  const keys = computers.map((one) => one.key).join("\n");
  useEffect(() => {
    if (ready) forgetComputers(bundleFiles(), keys.split("\n"));
    if (ready) disableRemovedComputers(keys.split("\n"));
  }, [ready, keys]);
  return useMemo(
    () => ({
      apps: shown === null ? [] : phoneAppsOf(shown.screens, shown.previews),
      state:
        read === null && loaded.state === "ready"
          ? "loading"
          : read === null && shown !== null
            ? "ready"
            : loaded.state,
      reload,
    }),
    [shown, loaded.state, reload],
  );
}
