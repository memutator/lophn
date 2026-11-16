// The screen of an app that runs on the phone: it opens from the phone's own copy, with or without its computer. The
// guest runs the app's backend on app.sqlite; external operations push the outbox first and then go to the view on the
// computer (opened while it is reachable). Not installed yet: it installs while the computer is reachable.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PhoneLocal, phoneCanRun } from "../../../../protocol/apps/phone-screen.ts";
import { useEventClient } from "../../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { newId } from "../../../../shell/renderer/prefixed-id.ts";
import type { ComputerItem, LocalAppsView, PhoneApp } from "../../data/mod.ts";
import type { BundleRefusal } from "../bundle.ts";
import {
  type AppEvent,
  ensureBase,
  type GuestAppDbProp,
  type GuestCall,
  type GuestState,
  guestHostInfo,
} from "../guest/mod.ts";
import { linkView, type ViewLink } from "../view.ts";
import { paths, releaseFiles, runsOnPhone } from "./folder.ts";

export type LocalScreenState =
  | { readonly kind: "loading" }
  /** Not on this phone yet and the computer is away: it installs once the computer is back. */
  | { readonly kind: "offline" }
  /** Being installed, or moving to a new release. */
  | { readonly kind: "installing" }
  | { readonly kind: "refused"; readonly reason: BundleRefusal }
  | { readonly kind: "failed"; readonly failure?: string }
  | {
      readonly kind: "running";
      readonly key: string;
      readonly view: string;
      readonly file: string;
      readonly call: GuestCall;
      readonly subscribe: (listener: (event: AppEvent) => void) => () => void;
      readonly onState: (state: GuestState) => void;
      readonly backendFile: string;
      readonly local: PhoneLocal;
      readonly appDb: GuestAppDbProp;
      readonly onLocalChange: () => void;
    };

export interface LocalScreen {
  readonly state: LocalScreenState;
  retry(): void;
}

let base: Promise<unknown> | null = null;
const baseReady = () => {
  base ??= ensureBase().catch((error: unknown) => {
    base = null;
    throw error;
  });
  return base;
};

const away: GuestCall = () =>
  Promise.resolve({ ok: false, error: { code: "unavailable", message: "the computer is not reachable" } });

/** null when the app does not run on the phone (its screen is the computer's, `useAppScreen`). */
export function useLocalScreen({
  computer,
  local,
  app: appId,
  phoneApp,
  screen: key,
}: {
  computer: ComputerItem | null;
  local: LocalAppsView;
  app: string;
  phoneApp: PhoneApp | undefined;
  screen: string | undefined;
}): LocalScreen | null {
  const client = useEventClient();
  const { store } = local;
  const entry = local.apps.find((one) => one.app === appId);
  const installed = store?.installed(appId) ?? null;
  const isLocal =
    store !== null &&
    (installed !== null ||
      entry !== undefined ||
      (phoneApp !== undefined && runsOnPhone(phoneApp.screens[0])));
  const online = computer?.status === "connected";
  const [view] = useState(() => newId("view"));
  const [attempt, setAttempt] = useState(0);
  const [guest, setGuest] = useState<{ key: string; state: GuestState } | null>(null);
  const [baseOk, setBaseOk] = useState<boolean | null>(null);

  const screen =
    installed === null
      ? undefined
      : key === undefined
        ? installed.screens[0]
        : installed.screens.find((one) => one.screen === key);
  const screenKey = screen?.screen;
  const fits = screen === undefined ? null : phoneCanRun(screen.manifest, guestHostInfo());

  // The view on the computer, for external operations and app events; a standalone app has neither. It comes and goes
  // with the computer while the guest stays, so the guest is given calls and events through the view open now.
  const link = useRef<ViewLink | null>(null);
  const [listeners] = useState(() => new Set<(event: AppEvent) => void>());
  const sync = installed?.kind === "sync";
  useEffect(() => {
    if (!isLocal || !sync || !online || screenKey === undefined) return;
    const next = linkView({
      client,
      input: { view, mode: "live", app: appId, release: null, screen: screenKey, place: "phone", params: {} },
      onState: () => {},
      onRebound: () => {},
    });
    link.current = next;
    const stop = next.subscribe((event) => {
      for (const listener of [...listeners]) listener(event);
    });
    return () => {
      stop();
      link.current = null;
      next.close();
    };
  }, [client, view, appId, screenKey, isLocal, sync, online, listeners]);

  useEffect(() => {
    if (!isLocal) return;
    let gone = false;
    baseReady().then(
      () => !gone && setBaseOk(true),
      () => !gone && setBaseOk(false),
    );
    return () => {
      gone = true;
    };
  }, [isLocal, attempt]);

  // Not installed and nothing under way: start it (the list read usually already did).
  const idle = entry === undefined;
  useEffect(() => {
    if (isLocal && installed === null && idle && online) store?.install(appId);
  }, [isLocal, installed, idle, online, store, appId]);

  const guestKey = `${installed?.release}:${screenKey}:${attempt}`;
  const state = ((): LocalScreenState => {
    if (entry?.state === "installing") return { kind: "installing" };
    if (installed === null) {
      if (entry?.state === "failed") return { kind: "failed", failure: entry.failure };
      return online ? { kind: "installing" } : { kind: "offline" };
    }
    if (screen === undefined || fits === null) return { kind: "failed" };
    if (!fits.ok) return { kind: "refused", reason: fits.reason };
    if (baseOk === null) return { kind: "loading" };
    if (!baseOk) return { kind: "failed" };
    if (guest?.key === guestKey && typeof guest.state === "object") return { kind: "failed" };
    const files = releaseFiles(computer!.key, appId, installed.release);
    const absolute = (path: string) => store!.absolute(path);
    return {
      kind: "running",
      key: guestKey,
      view,
      file: absolute(files.screen(screen.screen)),
      call: (operation, input) =>
        store!.external(appId, () => (link.current?.call ?? away)(operation, input)),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onState: (next) => setGuest({ key: guestKey, state: next }),
      backendFile: absolute(files.backend),
      local: { operations: installed.backend.operations, data_schema: installed.backend.data_schema },
      appDb: { path: absolute(paths(computer!.key, appId).db), record: sync },
      onLocalChange: () => store!.localChange(appId),
    };
  })();

  // A release change waits until the guest is gone; registered in the commit that mounts the guest.
  const running = isLocal && state.kind === "running";
  useLayoutEffect(() => {
    if (!running || store === null) return;
    return store.mount(appId);
  }, [running, store, appId]);

  if (!isLocal) return null;
  return {
    state,
    retry() {
      setGuest(null);
      setAttempt((n) => n + 1);
      if (installed === null) store?.install(appId);
      else store?.syncNow(appId);
    },
  };
}
