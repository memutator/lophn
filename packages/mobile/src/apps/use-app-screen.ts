// What a user app's phone screen shows, put together: the computer's state, the app in the screen list, whether this
// phone can run the screen, its bundle in the cache, the view on the computer and the guest itself.
import { useEffect, useRef, useState } from "react";
import { phoneCanRun } from "../../../protocol/apps/phone-screen.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import type { ComputerItem, PhoneApp, PhoneApps } from "../data/mod.ts";
import { type Bundle, type BundleRefusal, prepareBundle } from "./bundle.ts";
import { bundleFiles } from "./bundle-files.ts";
import {
  type AppEvent,
  createUpdateCoalescer,
  ensureBase,
  type GuestCall,
  type GuestState,
  guestHostInfo,
} from "./guest/mod.ts";
import { linkView, type ViewLink, type ViewState } from "./view.ts";

export type AppScreenState =
  | { readonly kind: "loading" }
  /** The computer is away: the screen opens by itself when it is back. */
  | { readonly kind: "offline" }
  /** The app does not run on its computer (stopped, archived, no live release). */
  | { readonly kind: "stopped" }
  | { readonly kind: "refused"; readonly reason: BundleRefusal }
  | { readonly kind: "failed" }
  | {
      readonly kind: "running";
      /** A new value runs the guest again: a new bundle or Try again. */
      readonly key: string;
      readonly view: string;
      readonly file: string;
      readonly call: GuestCall;
      readonly subscribe: (listener: (event: AppEvent) => void) => () => void;
      readonly onState: (state: GuestState) => void;
      /** What the screen may ask of the phone: this app's grants from the computer's list. */
      readonly phone: { readonly granted: readonly string[]; readonly standIn: boolean };
    };

// The guest's base bundle is copied out of the APK once per app start, before the first screen runs. Every screen waits
// on this one copy: ensureBase also clears the last run's wrapped backend copies, which a guest mounting meanwhile reads.
let base: Promise<unknown> | null = null;
export const baseReady = () => {
  base ??= ensureBase().catch((error: unknown) => {
    base = null;
    throw error;
  });
  return base;
};

export interface AppScreen {
  readonly state: AppScreenState;
  /** The bundle hash on screen when it replaced the one first shown (a new release went live while open); else null. */
  readonly update: string | null;
  retry(): void;
}

export function useAppScreen({
  computer,
  apps,
  app,
  screen: key,
}: {
  computer: ComputerItem | null;
  apps: PhoneApps;
  app: PhoneApp | undefined;
  screen: string | undefined;
}): AppScreen {
  const client = useEventClient();
  const [view] = useState(() => newId("view"));
  const [attempt, setAttempt] = useState(0);
  const screen =
    key === undefined
      ? app?.screens[0]
      : app?.screens.find((one) => one.screen === key);
  const online = computer?.status === "connected";
  const fits = screen === undefined ? null : phoneCanRun(screen.manifest, guestHostInfo());

  // The view on the computer: opened once the event client is ready, again after every reconnect.
  const [link, setLink] = useState<ViewLink | null>(null);
  const [bound, setBound] = useState<ViewState>({ kind: "opening" });
  const reload = useRef(apps.reload);
  reload.current = apps.reload;
  const appId = app?.app;
  const screenKey = screen?.screen;
  const runs = fits?.ok === true;
  useEffect(() => {
    if (appId === undefined || screenKey === undefined || !runs) return;
    setBound({ kind: "opening" });
    const next = linkView({
      client,
      input: {
        view,
        mode: "live",
        app: appId,
        release: null,
        screen: screenKey,
        place: "phone",
        params: {},
      },
      onState: setBound,
      onRebound: () => reload.current(),
    });
    setLink(next);
    return () => {
      setLink(null);
      next.close();
    };
  }, [client, view, appId, screenKey, runs]);

  // A stopped view is opened again when a new read of the list says the app runs (its process came back, or it was
  // still starting when the view was opened). Once per read, so a view that keeps failing does not loop.
  const stopped = useRef(false);
  stopped.current = bound.kind === "stopped";
  useEffect(() => {
    if (app?.running === true && stopped.current) link?.reopen();
  }, [app, link]);

  // The bundle: from the cache or the computer, checked against the manifest. Rapid consecutive release updates are
  // coalesced so an open guest screen remounts once for the latest release instead of once per intermediate release.
  const [bundle, setBundle] = useState<{ hash: string; got: Bundle } | null>(null);
  const [coalescer] = useState(() =>
    createUpdateCoalescer<{ hash: string; got: Bundle } | null>({
      onCommit: setBundle,
      equals: (a, b) => a?.hash === b?.hash && a?.got.ok === b?.got.ok,
    }),
  );
  useEffect(() => () => coalescer.cancel(), [coalescer]);
  const hash = screen?.bundle_hash;
  const computerKey = computer?.key;
  const latest = useRef(screen);
  latest.current = screen;
  useEffect(() => {
    const wanted = latest.current;
    if (wanted === undefined || computerKey === undefined || !online || !runs) return;
    let gone = false;
    void Promise.all([
      prepareBundle(
        { core: client.core, files: bundleFiles(), host: guestHostInfo() },
        computerKey,
        wanted,
      ),
      baseReady(),
    ]).then(
      ([got]) => {
        if (!gone) coalescer.push({ hash: wanted.bundle_hash, got });
      },
      () => {
        if (!gone) coalescer.push({ hash: wanted.bundle_hash, got: { ok: false, reason: "unavailable" } });
      },
    );
    return () => {
      gone = true;
    };
  }, [client, computerKey, hash, screenKey, online, runs, attempt, coalescer]);

  // The guest: failed until Try again or a new bundle.
  const [guest, setGuest] = useState<{ key: string; state: GuestState } | null>(null);
  const shown = bundle?.got.ok === true ? bundle.hash : null;
  const guestKey = `${shown}:${attempt}`;

  // Which bundle was first shown; any other one shown later is an update.
  const first = useRef<string | null>(null);
  if (first.current === null && shown !== null) first.current = shown;
  const update = shown !== null && first.current !== shown ? shown : null;

  const retry = () => {
    setGuest(null);
    coalescer.reset();
    setBundle(null);
    setAttempt((n) => n + 1);
    link?.reopen();
  };

  const state = ((): AppScreenState => {
    if (computer === null || computer.status === "connecting") return { kind: "loading" };
    if (!online) return { kind: "offline" };
    if (apps.state === "failed") return { kind: "failed" };
    if (apps.state === "loading") return { kind: "loading" };
    if (screen === undefined || fits === null) return { kind: "stopped" };
    if (!fits.ok) return { kind: "refused", reason: fits.reason };
    if (bound.kind === "stopped") return { kind: "stopped" };
    if (bound.kind === "failed") return { kind: "failed" };
    if (bound.kind === "opening" || link === null) return { kind: "loading" };
    // A bundle of the release before stays on screen until the new one is ready.
    if (bundle === null) return { kind: "loading" };
    if (!bundle.got.ok) return { kind: "failed" };
    if (guest?.key === guestKey && typeof guest.state === "object") return { kind: "failed" };
    return {
      kind: "running",
      key: guestKey,
      view,
      file: bundle.got.file,
      call: link.call,
      subscribe: link.subscribe,
      phone: { granted: screen.phone_capabilities, standIn: false },
      onState: (next) => {
        setGuest({ key: guestKey, state: next });
        if (typeof next === "object") {
          link.logError({
            observation: next.failed,
            message: next.message ?? `phone screen ${next.failed}`,
            ...(next.name === undefined ? {} : { name: next.name }),
          });
        }
      },
    };
  })();

  return { state, update, retry };
}
