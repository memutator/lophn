// The lists and icons the phone keeps of each computer (saved.ts), in the app's files folder, and the hooks that keep and
// read them. The sidebar keeps them: it is always mounted, so the computer on screen's lists and icons are read again
// when they change (`StateChanged` of apps, projects or releases) and after every reconnect. No hash: every read takes
// every icon again.
import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { appList } from "../../../protocol/apps/apps.ts";
import { appIcon as appIconRead } from "../../../protocol/apps/declaration/read.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import {
  readRoute,
  readsOf,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import { useComputers, useCurrentComputer } from "./hooks.tsx";
import { createSaved, type IconOwner, type SavedIcon, type SavedLists } from "./saved.ts";
import { type WorkspaceView, withSavedLists } from "./workspaces.ts";

export type { SavedIcon } from "./saved.ts";

// computers/ in the app's files folder.
const root = () => new Directory(Paths.document, "computers");
const fileAt = (path: string) => new File(root(), ...path.split("/"));

const saved = createSaved({
  readText(path) {
    const file = fileAt(path);
    return file.exists ? file.textSync() : null;
  },
  write(path, text) {
    const file = fileAt(path);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    file.writeSync(text);
  },
  remove(path) {
    const file = fileAt(path);
    if (file.exists) {
      file.delete();
      return;
    }
    const folder = path === "" ? root() : new Directory(root(), ...path.split("/"));
    if (folder.exists) folder.delete();
  },
  list(path) {
    const folder = path === "" ? root() : new Directory(root(), ...path.split("/"));
    return folder.exists ? folder.list().map((entry) => entry.name) : [];
  },
});

/** Every computer's kept lists and icons, read by a screen that knows which computer it shows. */
export const savedLists = saved;

const ALL = { limit: Number.MAX_SAFE_INTEGER };

interface Read {
  readonly computer: string | null;
  readonly lists: SavedLists;
  readonly icons: readonly { owner: IconOwner; id: string; icon: SavedIcon }[];
}

/**
 * Keeps the computer on screen's app and project lists and their icons on the phone, and drops what a computer the phone
 * no longer has kept. Mount once where it stays (the sidebar).
 */
export function useKeepLists(): void {
  const { ready, current, computers } = useComputers();
  const keys = computers.map((one) => one.key).join("\n");
  useEffect(() => {
    if (ready) saved.forget(keys === "" ? [] : keys.split("\n"));
  }, [ready, keys]);
  const { loaded } = useFollowedRead<Read>(
    async (core) => {
      const [apps, projects] = await Promise.all([
        readRoute(core, appList, ALL),
        readRoute(core, projectApi.list, ALL),
      ]);
      if (!apps.ok || !projects.ok) return { ok: false };
      const lists: SavedLists = {
        apps: apps.value.apps.map((one) => ({ id: one.id, name: one.name })),
        projects: projects.value.projects.map((one) => ({ id: one.id, title: one.title })),
      };
      // An icon that could not be read keeps what the phone has.
      const icons = await Promise.all([
        ...lists.apps.map(async ({ id }) => {
          const read = await readRoute(core, appIconRead, { app: id }).catch(() => ({ ok: false }) as const);
          return read.ok ? [{ owner: "app" as const, id, icon: read.value.icon }] : [];
        }),
        ...lists.projects.map(async ({ id }) => {
          const read = await readRoute(core, projectApi.icon, { project: id as `prj_${string}` }).catch(
            () => ({ ok: false }) as const,
          );
          return read.ok ? [{ owner: "project" as const, id, icon: read.value.icon }] : [];
        }),
      ]);
      return { ok: true, value: { computer: current, lists, icons: icons.flat() } };
    },
    [...readsOf(appList, ALL), ...readsOf(projectApi.list, ALL), "releases"],
    `kept:${current}`,
  );
  useEffect(() => {
    if (loaded.state !== "ready" || loaded.staleSince !== null) return;
    const { computer, lists, icons } = loaded.value;
    if (computer === null || computer !== current) return;
    saved.setLists(computer, lists);
    for (const one of icons) saved.setIcon(computer, one.owner, one.id, one.icon);
  }, [loaded, current]);
}

const useSavedVersion = () => useSyncExternalStore(saved.subscribe, saved.version);

/** The icon the phone keeps for an app or a project of the computer on screen; null when it has none or none was read. */
export function useSavedIcon(owner: IconOwner, id: string | null): SavedIcon {
  const computer = useCurrentComputer();
  useSavedVersion();
  return computer === null || id === null ? null : (saved.icon(computer.key, owner, id) ?? null);
}

/**
 * The workspaces with the apps and projects the phone kept of the computer on screen, while the computer is away or has
 * not listed them yet. A cold start offline still draws them (dimmed where the screen says).
 */
export function useWithSavedLists(workspaces: readonly WorkspaceView[]): readonly WorkspaceView[] {
  const computer = useCurrentComputer();
  const version = useSavedVersion();
  const key = computer?.key ?? null;
  const online = computer?.status === "connected";
  return useMemo(
    () => (key === null ? workspaces : withSavedLists(workspaces, saved.lists(key), online)),
    [workspaces, key, online, version],
  );
}
