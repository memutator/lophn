// The apps of the computer on screen that run on the phone: what is installed, its sync state, and the host's sync
// work (src/apps/local). Every paired computer's apps sync while its link is connected (local-stores.ts); this hook
// gives the computer on screen's store its list from that computer, which installs, moves and prunes its apps.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import type { LocalApp, LocalApps } from "../apps/local/store.ts";
import { usePhoneApps } from "./apps.ts";
import { useCurrentComputer } from "./hooks.tsx";
import { localStore } from "./local-stores.ts";
import { appIcon, type WorkspaceView } from "./workspaces.ts";

export type { Installed, LocalKind } from "../apps/local/folder.ts";
export type { LocalApp, LocalAppState, LocalApps, LocalFailure } from "../apps/local/store.ts";

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

/** The apps installed on this phone: not one whose first install is under way or failed. */
export function installedOf(local: LocalAppsView): readonly LocalApp[] {
  return local.apps.filter((one) => local.store?.installed(one.app) != null);
}

/**
 * The workspaces with the installed apps they do not list: after a restart while the computer is away the phone has
 * no list from it, and a standalone app the computer dropped stays on the phone. Both still open here.
 */
export function withLocalApps(
  workspaces: readonly WorkspaceView[],
  installed: readonly LocalApp[],
): readonly WorkspaceView[] {
  const known = new Set(workspaces.map((one) => one.key));
  const more = installed
    .filter((one) => !known.has(one.app))
    .map(
      (one): WorkspaceView => ({
        key: one.app,
        kind: "app",
        workspace: { kind: "app", id: one.app } as Workspace,
        name: one.name,
        icon: appIcon(one.app, one.name),
        groups: [],
        recent: [],
      }),
    );
  return more.length === 0 ? workspaces : [...workspaces, ...more];
}

export function useLocalApps(): LocalAppsView {
  const computer = useCurrentComputer();
  const phone = usePhoneApps();
  const computerKey = computer === null || computer.sample ? null : computer.key;
  const store = computerKey === null ? null : localStore();
  const online = computer?.status === "connected";
  const all = useSyncExternalStore(store?.subscribe ?? nothing, store?.get ?? (() => NONE));
  const apps = useMemo(
    () => (store === null || computerKey === null ? NONE : store.forComputer(computerKey)),
    [all, store, computerKey],
  );

  useEffect(() => {
    if (store === null || computerKey === null || !online || phone.state !== "ready") return;
    store.list(
      computerKey,
      phone.apps.flatMap((one) => one.screens),
      phone.reload,
    );
  }, [store, computerKey, online, phone.apps, phone.state, phone.reload]);

  return useMemo(
    () => ({
      apps,
      syncNow: (app: string) => store?.syncNow(app),
      install: (app: string) => store?.install(app, computerKey ?? undefined),
      store,
    }),
    [apps, store, computerKey],
  );
}
