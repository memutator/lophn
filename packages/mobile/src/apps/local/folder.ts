// One app that runs on the phone, on disk: `files/apps/<computer>/<app>/`.
//   installed.json                     what is installed (written last: a folder without it is an install that stopped)
//   app.sqlite                         the app's data, its clocks and (sync apps) its outbox
//   app.before-<rel>.sqlite            the backup taken when <rel> replaced the release before; kept until the first
//                                      push on <rel> succeeds
//   release/<rel>/backend.js, backend.json, migrations/<from>-<to>.sql, screens/<screen>/phone.js
//   work/                              files being put together (a snapshot, a migrated copy); gone after each step
import type { PhoneBackendManifest } from "../../../../protocol/apps/phone-backend.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import type { LocalFiles } from "./ports.ts";

export type LocalKind = "sync" | "standalone";

export interface Installed {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: LocalKind;
  readonly release: string;
  /** The release's phone screens as `apps/phone_screens` listed them; their phone.js is in the release folder. */
  readonly screens: readonly PhoneScreen[];
  readonly backend: PhoneBackendManifest;
  readonly last_synced_at: string | null;
  /** The release whose backup (app.before-<rel>.sqlite) is kept; null when there is none. */
  readonly backup: string | null;
}

export const kindOf = (screen: PhoneScreen): LocalKind =>
  screen.runs_on.includes("computer") ? "sync" : "standalone";

export const runsOnPhone = (screen: PhoneScreen): boolean =>
  screen.runs_on.includes("phone") && screen.backend !== null;

export function appDir(computer: string, app: string): string {
  return `${computer}/${app}`;
}

export const paths = (computer: string, app: string) => {
  const dir = appDir(computer, app);
  return {
    dir,
    installed: `${dir}/installed.json`,
    db: `${dir}/app.sqlite`,
    backup: (release: string) => `${dir}/app.before-${release}.sqlite`,
    releases: `${dir}/release`,
    release: (release: string) => `${dir}/release/${release}`,
    work: `${dir}/work`,
  };
};

export const releaseFiles = (computer: string, app: string, release: string) => {
  const dir = paths(computer, app).release(release);
  return {
    backend: `${dir}/backend.js`,
    manifest: `${dir}/backend.json`,
    migration: (file: string) => `${dir}/${file}`,
    screen: (screen: string) => `${dir}/screens/${screen}/phone.js`,
  };
};

export function readInstalled(
  files: LocalFiles,
  computer: string,
  app: string,
): Installed | null {
  const text = files.readText(paths(computer, app).installed);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Installed;
  } catch {
    return null;
  }
}

export function writeInstalled(files: LocalFiles, computer: string, installed: Installed): void {
  files.write(paths(computer, installed.app).installed, JSON.stringify(installed));
}

/** Every installed app of a computer. */
export function listInstalled(files: LocalFiles, computer: string): Installed[] {
  return files
    .list(computer)
    .map((app) => readInstalled(files, computer, app))
    .filter((one) => one !== null);
}

/** SQLite's own files next to a database; they go with it when it is moved or removed. */
export const SIDE_FILES = ["-wal", "-shm", "-journal"];

export function removeDb(files: LocalFiles, path: string): void {
  files.remove(path);
  for (const side of SIDE_FILES) files.remove(`${path}${side}`);
}
