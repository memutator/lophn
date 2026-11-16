// The user apps of the computer on screen that have a phone screen (`apps/phone_screens`), read again on reconnect and
// when a release or an app process changes. A screen whose params are required is left out: the phone has nowhere to
// give them.
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
import { useComputers } from "./hooks.tsx";

export type PhoneScreen = z.output<
  typeof appPhoneScreens.output
>["screens"][number];

export interface PhoneApp {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  /** Its first phone screen is the app's screen; the rest open from its menu. */
  readonly screens: readonly [PhoneScreen, ...PhoneScreen[]];
  /** The live release's process runs on the computer now. */
  readonly running: boolean;
}

const needsParams = (screen: PhoneScreen) =>
  (screen.params?.required?.length ?? 0) > 0;

export function phoneAppsOf(screens: readonly PhoneScreen[]): PhoneApp[] {
  const byApp = new Map<string, PhoneScreen[]>();
  for (const screen of screens) {
    if (needsParams(screen)) continue;
    byApp.set(screen.app, [...(byApp.get(screen.app) ?? []), screen]);
  }
  return [...byApp.values()].map((list) => {
    const first = list[0]!;
    return {
      app: first.app,
      name: first.app_name,
      icon: first.icon,
      screens: list as [PhoneScreen, ...PhoneScreen[]],
      running: first.running,
    };
  });
}

// The last list read from each computer this run. A screen opened while its computer is away has no read of its own
// yet; it still knows the app's name from here.
const lastRead = new Map<string, readonly PhoneScreen[]>();

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
        ? { ok: true, value: { computer: current, screens: read.value.screens } }
        : read;
    },
    readsOf(appPhoneScreens, {}),
    `phone_screens:${current}`,
  );
  const value = loaded.state === "ready" ? loaded.value : null;
  const read = value?.computer === current ? (value?.screens ?? null) : null;
  const screens = read ?? (current === null ? null : (lastRead.get(current) ?? null));
  useEffect(() => {
    if (value === null || value.computer === null) return;
    lastRead.set(value.computer, value.screens);
    forgetApps(
      bundleFiles(),
      value.computer,
      value.screens.map((one) => one.app),
    );
  }, [value]);
  const keys = computers.map((one) => one.key).join("\n");
  useEffect(() => {
    if (ready) forgetComputers(bundleFiles(), keys.split("\n"));
  }, [ready, keys]);
  return useMemo(
    () => ({
      apps: screens === null ? [] : phoneAppsOf(screens),
      state:
        read === null && loaded.state === "ready"
          ? "loading"
          : read === null && screens !== null
            ? "ready"
            : loaded.state,
      reload,
    }),
    [screens, loaded.state, reload],
  );
}
