// What the phone keeps of each computer between runs, so a screen draws before the computer answers (or while it is
// away) and then takes the new value: the computer's app and project lists and their icons. Only light things; a
// conversation is never kept. Without React or Expo: the files come in as a port.
//
// Files, relative to the port's folder: `<computer>/lists.json`, and one `<computer>/icons/<app|project>-<id>.json` per
// app or project whose icon was read. A computer the phone no longer has loses its folder.
import type { AppIcon } from "../../../protocol/apps/declaration/read.ts";

export interface SavedFiles {
  /** null when there is no such file. */
  readText(path: string): string | null;
  /** Makes the folders on the way. */
  write(path: string, text: string): void;
  /** A file or a whole folder; nothing when it is not there. */
  remove(path: string): void;
  /** Names in a folder; empty when it is not there. */
  list(path: string): string[];
}

export interface SavedLists {
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly projects: readonly { readonly id: string; readonly title: string }[];
}

export type IconOwner = "app" | "project";

/** A project's icon is only ever an image; an app's may be a lucide name. null: it has none, the mark draws. */
export type SavedIcon = AppIcon | null;

interface Kept {
  lists: SavedLists | null;
  icons: Map<string, SavedIcon>;
}

const LISTS = "lists.json";
const ICONS = "icons";
const iconName = (owner: IconOwner, id: string) => `${owner}-${id}.json`;

function parse<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function createSaved(files: SavedFiles) {
  const computers = new Map<string, Kept>();
  const listeners = new Set<() => void>();
  // A new object per change, so a hook reading it sees that something changed.
  let version = 0;
  const changed = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  function kept(computer: string): Kept {
    let one = computers.get(computer);
    if (one !== undefined) return one;
    const icons = new Map<string, SavedIcon>();
    for (const name of files.list(`${computer}/${ICONS}`)) {
      const icon = parse<{ icon: SavedIcon }>(files.readText(`${computer}/${ICONS}/${name}`));
      if (icon !== null) icons.set(name, icon.icon);
    }
    one = { lists: parse<SavedLists>(files.readText(`${computer}/${LISTS}`)), icons };
    computers.set(computer, one);
    return one;
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    /** The lists last read from the computer; null before the first read on this phone. */
    lists: (computer: string): SavedLists | null => kept(computer).lists,
    /** Keeps the lists and drops the icons of apps and projects no longer in them. */
    setLists(computer: string, lists: SavedLists) {
      const one = kept(computer);
      const text = JSON.stringify(lists);
      if (JSON.stringify(one.lists) === text) return;
      one.lists = lists;
      files.write(`${computer}/${LISTS}`, text);
      const listed = new Set([
        ...lists.apps.map((app) => iconName("app", app.id)),
        ...lists.projects.map((project) => iconName("project", project.id)),
      ]);
      for (const name of [...one.icons.keys()]) {
        if (listed.has(name)) continue;
        one.icons.delete(name);
        files.remove(`${computer}/${ICONS}/${name}`);
      }
      changed();
    },
    /** undefined: never read on this phone. */
    icon: (computer: string, owner: IconOwner, id: string): SavedIcon | undefined =>
      kept(computer).icons.get(iconName(owner, id)),
    setIcon(computer: string, owner: IconOwner, id: string, icon: SavedIcon) {
      const one = kept(computer);
      const name = iconName(owner, id);
      const text = JSON.stringify({ icon });
      if (one.icons.has(name) && JSON.stringify({ icon: one.icons.get(name) }) === text) return;
      one.icons.set(name, icon);
      files.write(`${computer}/${ICONS}/${name}`, text);
      changed();
    },
    /** `paired`: the computers the phone still has. Every other computer's lists and icons go. */
    forget(paired: readonly string[]) {
      const keep = new Set(paired);
      let any = false;
      for (const computer of new Set([...files.list(""), ...computers.keys()])) {
        if (keep.has(computer)) continue;
        files.remove(computer);
        computers.delete(computer);
        any = true;
      }
      if (any) changed();
    },
  };
}

export type Saved = ReturnType<typeof createSaved>;
