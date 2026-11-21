// One app that runs on the phone, on disk: `files/apps/<app>/` (one shared copy across all paired computers).
//   installed.json                     what is installed (written last: a folder without it is an install that stopped)
//   app.sqlite                         the app's data, its clocks, per-computer pull cursors and (sync apps) its outbox
//   app.before-<rel>.sqlite            the backup taken when <rel> replaced the release before; kept until the first
//                                      push on <rel> succeeds
//   release/<rel>/backend.js, backend.json, migrations/<from>-<to>.sql, screens/<screen>/phone.js
//   files/<two hex>/<sha256>           the app's files (immutable, named by their content); the app's data like its database
//   held/<computer>.json               which of the app's files that computer has acknowledged (`stored` or `have`) and which it
//                                      refused for good; what a computer still lacks is the files/ folder minus this record. The
//                                      folder stays while a computer lacks a file
//   work/                              files being put together (a snapshot, a migrated copy); gone after each step
import type { PhoneBackendManifest } from "../../../../protocol/apps/phone-backend.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import type { LocalDeps, LocalFiles } from "./ports.ts";

export type LocalKind = "sync" | "standalone";

export interface Installed {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: LocalKind;
  readonly release: string;
  /** Cross-machine release identity (git commit); two paired computers on the same commit share this value. */
  readonly code_commit?: string;
  /** Each paired computer's local release id (`rel_*`) for the installed `code_commit`. */
  readonly computer_releases?: Readonly<Record<string, string>>;
  /** The release's phone screens as `apps/phone_screens` listed them; their phone.js is in the release folder. */
  readonly screens: readonly PhoneScreen[];
  readonly backend: PhoneBackendManifest;
  readonly last_synced_at: string | null;
  /** The release whose backup (app.before-<rel>.sqlite) is kept; null when there is none. */
  readonly backup: string | null;
  /** Paired computer keys known to have this app; drives per-computer lists and pruning when all computers drop it. */
  readonly computers: readonly string[];
  /**
   * Set when this folder was migrated from legacy `<computer>/<app>/`, so pull falls back from the legacy `cursor`
   * key in `lophn_sync_state` for that computer until `cursor:<computer>` is written.
   */
  readonly migrated_from?: string;
}

export const kindOf = (screen: PhoneScreen): LocalKind =>
  screen.runs_on.includes("computer") ? "sync" : "standalone";

export const runsOnPhone = (screen: PhoneScreen): boolean =>
  screen.runs_on.includes("phone") && screen.backend !== null;

/**
 * Orders two releases of an app: matching `code_commit` means the exact same release (even when two paired computers
 * assigned different local `rel_*` ULIDs and `bundle_hash`es); otherwise higher `data_schema` wins when both are known
 * and differ, falling back to lexicographical release id order (ULID-based `rel_*` ids sort by creation time).
 */
export function compareRelease(
  a: { readonly release: string; readonly code_commit?: string; readonly data_schema?: number },
  b: { readonly release: string; readonly code_commit?: string; readonly data_schema?: number },
): number {
  if (
    a.code_commit !== undefined &&
    b.code_commit !== undefined &&
    a.code_commit === b.code_commit
  ) {
    return 0;
  }
  if (
    a.data_schema !== undefined &&
    b.data_schema !== undefined &&
    a.data_schema !== b.data_schema
  ) {
    return a.data_schema - b.data_schema;
  }
  return a.release < b.release ? -1 : a.release > b.release ? 1 : 0;
}

/**
 * `screens` with the phone capabilities of the same screens in a fresh listing of the same release (the person gave or took
 * back a grant since the install). Returns `screens` itself when nothing changed.
 */
export function withPhoneCapabilities(
  screens: readonly PhoneScreen[],
  listed: readonly PhoneScreen[],
): readonly PhoneScreen[] {
  let changed = false;
  const next = screens.map((screen) => {
    const fresh = listed.find((one) => one.screen === screen.screen)?.phone_capabilities;
    if (
      fresh === undefined ||
      (fresh.length === screen.phone_capabilities.length &&
        fresh.every((name, at) => name === screen.phone_capabilities[at]))
    ) {
      return screen;
    }
    changed = true;
    return { ...screen, phone_capabilities: fresh };
  });
  return changed ? next : screens;
}

export function withComputer(computers: readonly string[], computer: string): readonly string[] {
  return computers.includes(computer) ? computers : [...computers, computer];
}

export function withComputerRelease(
  releases: Readonly<Record<string, string>> | undefined,
  computer: string,
  release: string,
): Readonly<Record<string, string>> {
  if (releases?.[computer] === release) return releases;
  return { ...releases, [computer]: release };
}

export function dropComputerReleases(
  releases: Readonly<Record<string, string>> | undefined,
  drop: (computer: string) => boolean,
): Readonly<Record<string, string>> | undefined {
  if (releases === undefined) return undefined;
  const next: Record<string, string> = {};
  for (const [computer, release] of Object.entries(releases)) {
    if (!drop(computer)) next[computer] = release;
  }
  return next;
}

export function appDir(app: string): string {
  return app;
}

export const paths = (app: string) => {
  const dir = appDir(app);
  return {
    dir,
    installed: `${dir}/installed.json`,
    db: `${dir}/app.sqlite`,
    backup: (release: string) => `${dir}/app.before-${release}.sqlite`,
    releases: `${dir}/release`,
    release: (release: string) => `${dir}/release/${release}`,
    work: `${dir}/work`,
    files: `${dir}/files`,
    held: (computer: string) => `${dir}/held/${computer}.json`,
  };
};

export const releaseFiles = (app: string, release: string) => {
  const dir = paths(app).release(release);
  return {
    backend: `${dir}/backend.js`,
    manifest: `${dir}/backend.json`,
    migration: (file: string) => `${dir}/${file}`,
    screen: (screen: string) => `${dir}/screens/${screen}/phone.js`,
  };
};

function parseInstalled(text: string | null): Installed | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Installed & {
      computers?: readonly string[];
      computer_releases?: Record<string, unknown>;
    };
    const codeCommit =
      typeof raw.code_commit === "string"
        ? raw.code_commit
        : typeof raw.screens?.[0]?.code_commit === "string"
          ? raw.screens[0].code_commit
          : undefined;
    let computerReleases: Record<string, string> | undefined;
    if (raw.computer_releases && typeof raw.computer_releases === "object") {
      computerReleases = {};
      for (const [k, v] of Object.entries(raw.computer_releases)) {
        if (typeof v === "string") computerReleases[k] = v;
      }
    }
    return {
      ...raw,
      // A record written before screens carried phone capabilities: none until the next read of the computer's list.
      screens: (raw.screens ?? []).map((screen) => ({
        ...screen,
        phone_capabilities: Array.isArray(screen.phone_capabilities) ? screen.phone_capabilities : [],
      })),
      ...(codeCommit === undefined ? {} : { code_commit: codeCommit }),
      ...(computerReleases === undefined ? {} : { computer_releases: computerReleases }),
      computers: Array.isArray(raw.computers) ? raw.computers : [],
    };
  } catch {
    return null;
  }
}

export function readInstalled(files: LocalFiles, app: string): Installed | null {
  return parseInstalled(files.readText(paths(app).installed));
}

export function writeInstalled(files: LocalFiles, installed: Installed): void {
  files.write(paths(installed.app).installed, JSON.stringify(installed));
}

/** Every installed app on this phone (shared `files/apps/<app>/` folders). */
export function listInstalled(files: LocalFiles): Installed[] {
  return files
    .list("")
    .map((entry) => readInstalled(files, entry))
    .filter((one): one is Installed => one !== null);
}

/** SQLite's own files next to a database; they go with it when it is moved or removed. */
export const SIDE_FILES = ["-wal", "-shm", "-journal"];

export function removeDb(files: LocalFiles, path: string): void {
  files.remove(path);
  for (const side of SIDE_FILES) files.remove(`${path}${side}`);
}

function legacyOutboxCount(deps: LocalDeps, dbPath: string): number {
  if (!deps.files.exists(dbPath)) return 0;
  try {
    const db = deps.open(deps.files.absolute(dbPath));
    try {
      const row = db.all("select count(*) as n from lophn_sync_outbox")[0];
      return Number(row?.["n"] ?? 0);
    } finally {
      db.close();
    }
  } catch {
    // If the DB cannot be read, treat as non-empty so migration never discards potentially unsent data.
    return 1;
  }
}

/**
 * Seamlessly moves legacy `<computer>/<app>/` folders into the shared `<app>/` folder.
 * When multiple legacy computers had copies of the same app, prefers the newest release (then highest outbox count)
 * as the primary folder, merges all computer keys into `installed.computers`, and only deletes redundant legacy sync
 * copies whose outbox is empty (standalone data and unsent outboxes are never discarded).
 */
export function migrateLegacyFolders(deps: LocalDeps): void {
  const { files } = deps;
  type Legacy = { computer: string; app: string; dir: string; installed: Installed; outbox: number };
  const byApp = new Map<string, Legacy[]>();
  const legacyComputers: string[] = [];

  for (const entry of files.list("")) {
    // A top-level folder with installed.json is already a shared app folder.
    if (files.exists(paths(entry).installed)) continue;
    legacyComputers.push(entry);
    for (const app of files.list(entry)) {
      const dir = `${entry}/${app}`;
      const record = parseInstalled(files.readText(`${dir}/installed.json`));
      if (record === null) {
        files.remove(dir);
        continue;
      }
      const outbox = record.kind === "sync" ? legacyOutboxCount(deps, `${dir}/app.sqlite`) : 0;
      const list = byApp.get(app) ?? [];
      list.push({ computer: entry, app, dir, installed: record, outbox });
      byApp.set(app, list);
    }
  }

  for (const [app, copies] of byApp) {
    copies.sort((a, b) => {
      const rel = compareRelease(
        { release: b.installed.release, data_schema: b.installed.backend.data_schema },
        { release: a.installed.release, data_schema: a.installed.backend.data_schema },
      );
      if (rel !== 0) return rel;
      return b.outbox - a.outbox;
    });
    let current = readInstalled(files, app);
    for (const copy of copies) {
      if (current === null) {
        files.remove(appDir(app));
        files.move(copy.dir, appDir(app));
        const computers = withComputer(copy.installed.computers, copy.computer);
        current = {
          ...copy.installed,
          computers,
          ...(copy.installed.kind === "sync" ? { migrated_from: copy.computer } : {}),
        };
        writeInstalled(files, current);
      } else {
        const computers = withComputer(current.computers, copy.computer);
        if (computers !== current.computers) {
          current = { ...current, computers };
          writeInstalled(files, current);
        }
        if (copy.installed.kind === "sync" && copy.outbox === 0) {
          files.remove(copy.dir);
        }
      }
    }
  }

  for (const computer of legacyComputers) {
    if (files.list(computer).length === 0) files.remove(computer);
  }
}
