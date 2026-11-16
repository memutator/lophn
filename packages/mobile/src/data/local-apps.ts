// The apps of the computer on screen that run on the phone: what is installed, its sync state, and the host's sync
// work (src/apps/local). Sync runs while the computer is connected and a screen holding this hook is mounted (the
// phone app is in front); the work itself is per computer and outlives the screens.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { nativeDeps } from "../apps/local/native.ts";
import { createLocalApps, type LocalApp, type LocalApps } from "../apps/local/store.ts";
import { loadComputers } from "../pairing/store.ts";
import { usePhoneApps } from "./apps.ts";
import { useCurrentComputer } from "./hooks.tsx";

export type { Installed, LocalKind } from "../apps/local/folder.ts";
export type { LocalApp, LocalAppState, LocalApps } from "../apps/local/store.ts";

// One store per computer for the app's life: the sync work of a computer goes on while its screens come and go.
const stores = new Map<string, LocalApps>();
const holders = new Map<LocalApps, number>();

function storeFor(computer: string): LocalApps {
  let store = stores.get(computer);
  if (store === undefined) {
    store = createLocalApps({
      ...nativeDeps,
      computer,
      node: async () => {
        const saved = (await loadComputers()).find((one) => one.key === computer);
        if (saved === undefined) throw new Error("the computer is not paired");
        return saved.device;
      },
    });
    stores.set(computer, store);
  }
  return store;
}

const NONE: readonly LocalApp[] = [];
const nothing = () => () => {};

export interface LocalAppsView {
  /** The computer on screen's apps that run on the phone: installed, being installed, or whose install failed. */
  readonly apps: readonly LocalApp[];
  syncNow(app: string): void;
  /** Starts installing the app (it also starts by itself once the computer lists it). */
  install(app: string): void;
  /** The computer's store; null for no computer or the sample one. */
  readonly store: LocalApps | null;
}

export function useLocalApps(): LocalAppsView {
  const computer = useCurrentComputer();
  const client = useEventClient();
  const phone = usePhoneApps();
  const store = computer === null || computer.sample ? null : storeFor(computer.key);
  const online = computer?.status === "connected";
  const apps = useSyncExternalStore(store?.subscribe ?? nothing, store?.get ?? (() => NONE));

  useEffect(() => {
    if (store === null) return;
    holders.set(store, (holders.get(store) ?? 0) + 1);
    store.connect(online ? client.core : null);
    return () => {
      const left = (holders.get(store) ?? 1) - 1;
      holders.set(store, left);
      if (left === 0) store.connect(null);
    };
  }, [store, online, client]);

  useEffect(() => {
    if (store === null || !online || phone.state !== "ready") return;
    store.list(
      phone.apps.flatMap((one) => one.screens),
      phone.reload,
    );
  }, [store, online, phone.apps, phone.state, phone.reload]);

  useEffect(() => {
    if (store === null) return;
    return client.subscribe({ types: ["AppSyncChanged"] }, (message) => {
      if (message.kind === "event" && message.event.type === "AppSyncChanged") {
        store.changed(message.event.subject);
      }
    });
  }, [store, client]);

  return useMemo(
    () => ({
      apps,
      syncNow: (app: string) => store?.syncNow(app),
      install: (app: string) => store?.install(app),
      store,
    }),
    [apps, store],
  );
}
