// All apps on this phone that run locally, across all paired computers, without React Native.
// Each app has ONE shared folder (`files/apps/<app>/`) and ONE SQLite database on the phone. Work on one app runs one
// step at a time across all computers (install, sync, release change, prune, external), so two connected computers
// never touch the same SQLite file concurrently; different apps run side by side.
//
// Sync runs while at least one paired computer for the app is reachable (`connect`) and the phone app is in front.
// Its cues: a local change, a computer connecting, AppSyncChanged from any computer, a list read, `syncNow`. One sync
// against a computer is push then pull (with that computer's own `cursor:<computer>`). Computers whose active release
// lags behind the phone's installed release are skipped; any connected computer advertising a newer live release
// upgrades the shared copy (waiting for the guest to unmount first).
import type { PhoneScreen } from "../../data/apps.ts";
import type { CallOutcome } from "../guest/mod.ts";
import { outboxCount, withDb } from "./db.ts";
import {
  compareRelease,
  dropComputerReleases,
  type Installed,
  kindOf,
  type LocalKind,
  listInstalled,
  migrateLegacyFolders,
  paths,
  readInstalled,
  runsOnPhone,
  withComputer,
  withComputerRelease,
  withPhoneCapabilities,
  writeInstalled,
} from "./folder.ts";
import { type Ctx, type InstallStep, install } from "./install.ts";
import type { LocalDeps, Remote } from "./ports.ts";
import { pruneApp } from "./prune.ts";
import { switchRelease } from "./release.ts";
import { pull, push } from "./sync.ts";

export type LocalAppState = "ready" | "installing" | "syncing" | "failed";

/**
 * Why the last install, sync or release change did not go through: the error code, and for an install the step it
 * stopped at. What the computer said with it is only logged: it is the computer's own wording, not the person's.
 */
export type LocalFailure = { readonly code: string; readonly step?: InstallStep };

export interface LocalApp {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: LocalKind;
  readonly release: string;
  /** When push and pull last both went through; null for a standalone app. */
  readonly last_synced_at: string | null;
  /** Local changes not yet acked by any connected computer. */
  readonly pending: number;
  readonly state: LocalAppState;
  readonly failure?: LocalFailure;
}

type Screens = readonly [PhoneScreen, ...PhoneScreen[]];

export interface LocalAppsDeps extends LocalDeps {
  /** This phone's id in the roster (the sync node). */
  node(): Promise<string>;
}

export interface LocalApps {
  get(): readonly LocalApp[];
  /** The local apps associated with `computer` (installed for it, or currently installing/failed from its list). */
  forComputer(computer: string): readonly LocalApp[];
  subscribe(listener: () => void): () => void;
  /** What is installed for an app (its shared folder), or null. */
  installed(app: string): Installed | null;
  /** The absolute path of a path in the app folders (folder.ts). */
  absolute(path: string): string;
  /** `computer` is reachable through `remote`, or not (null). */
  connect(computer: string, remote: Remote | null): void;
  /**
   * `computer`'s `apps/phone_screens` list, read while it is reachable. Installs missing phone apps, upgrades installed
   * ones when `computer` advertises a newer live release, skips lagging computers, and prunes sync apps dropped by all
   * paired computers. `reload` reads `computer`'s list again.
   */
  list(computer: string, screens: readonly PhoneScreen[], reload: () => void): void;
  /** Drops computers no longer in `paired`, pruning sync apps that belong to no remaining computer when outbox is empty. */
  forget(paired: readonly string[]): void;
  install(app: string, computer?: string): void;
  syncNow(app: string): void;
  /** A guest's local call committed a change. */
  localChange(app: string): void;
  /** AppSyncChanged for `app` from `computer`. */
  changed(computer: string, app: string): void;
  /** An external operation on `computer`: the outbox goes to `computer` first; when it cannot, returns `unavailable`. */
  external(computer: string, app: string, send: () => Promise<CallOutcome>): Promise<CallOutcome>;
  /** A guest of the app is mounted until the returned function runs. A release change waits for none. */
  mount(app: string): () => void;
}

const unavailable = (message: string): CallOutcome => ({
  ok: false,
  error: { code: "unavailable", message },
});

const screenRelease = (screen: PhoneScreen) => ({
  release: screen.release,
  code_commit: screen.code_commit,
  data_schema: screen.backend?.data_schema,
});

const installedRelease = (one: Installed) => ({
  release: one.release,
  code_commit: one.code_commit,
  data_schema: one.backend.data_schema,
});

export function createLocalApps(deps: LocalAppsDeps): LocalApps {
  const { files } = deps;
  const remotes = new Map<string, Remote>();
  const listed = new Map<string, Map<string, Screens>>();
  const reloads = new Map<string, () => void>();
  // Remembered when a computer's push conflict reports an older active_release before its list is read.
  const lagging = new Map<string, Map<string, { release: string; code_commit?: string }>>();
  const busy = new Map<string, "installing" | "syncing">();
  const failures = new Map<string, LocalFailure>();
  const pending = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  const syncQueued = new Set<string>();
  const mounts = new Map<string, number>();
  const unmounted = new Map<string, (() => void)[]>();
  const listeners = new Set<() => void>();
  let installed = new Map<string, Installed>();
  let apps: readonly LocalApp[] = [];
  let byComputer = new Map<string, readonly LocalApp[]>();

  function publish() {
    installed = new Map(listInstalled(files).map((one) => [one.app, one]));
    const stateOf = (app: string): LocalAppState =>
      busy.get(app) ?? (failures.has(app) ? "failed" : "ready");
    const failure = (app: string) => (failures.has(app) ? { failure: failures.get(app)! } : {});
    const allById = new Map<string, LocalApp>();
    for (const one of installed.values()) {
      allById.set(one.app, {
        app: one.app,
        name: one.name,
        icon: one.icon,
        kind: one.kind,
        release: one.release,
        last_synced_at: one.last_synced_at,
        pending: pending.get(one.app) ?? 0,
        state: stateOf(one.app),
        ...failure(one.app),
      });
    }
    // Apps being installed, or whose install failed, from any computer's list.
    for (const map of listed.values()) {
      for (const [app, screens] of map) {
        if (allById.has(app) || (!busy.has(app) && !failures.has(app))) continue;
        const first = screens[0];
        allById.set(app, {
          app,
          name: first.app_name,
          icon: first.icon,
          kind: kindOf(first),
          release: first.release,
          last_synced_at: null,
          pending: 0,
          state: stateOf(app),
          ...failure(app),
        });
      }
    }
    apps = [...allById.values()];
    byComputer = new Map();
    for (const listener of [...listeners]) listener();
  }

  function fail(app: string, error: { code: string; message: string }, step?: InstallStep) {
    console.warn(`app ${app}${step === undefined ? "" : ` (${step})`}: ${error.code}: ${error.message}`);
    failures.set(app, step === undefined ? { code: error.code } : { code: error.code, step });
  }

  function queued<T>(app: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(app) ?? Promise.resolve()).then(work);
    const settled = run.catch((thrown: unknown) => {
      fail(app, { code: "internal", message: thrown instanceof Error ? thrown.message : String(thrown) });
      busy.delete(app);
      publish();
    });
    queues.set(app, settled);
    return run;
  }

  async function context(computer: string): Promise<Ctx | null> {
    const remote = remotes.get(computer);
    if (remote === undefined) return null;
    return { deps, remote, computer, node: await deps.node() };
  }

  async function countPending(app: string) {
    const one = readInstalled(files, app);
    if (one === null || one.kind !== "sync") {
      pending.delete(app);
      return;
    }
    pending.set(app, await withDb(deps, paths(app).db, outboxCount));
  }

  function untilUnmounted(app: string): Promise<void> {
    if ((mounts.get(app) ?? 0) === 0) return Promise.resolve();
    return new Promise((resolve) => {
      unmounted.set(app, [...(unmounted.get(app) ?? []), resolve]);
    });
  }

  function isLagging(computer: string, one: Installed): boolean {
    const screens = listed.get(computer)?.get(one.app);
    if (screens !== undefined) {
      return compareRelease(screenRelease(screens[0]), installedRelease(one)) < 0;
    }
    const known = lagging.get(computer)?.get(one.app);
    return (
      known !== undefined &&
      compareRelease(known, { release: one.release, code_commit: one.code_commit }) < 0
    );
  }

  function recordLagging(computer: string, app: string, release: string, code_commit?: string) {
    const map = lagging.get(computer) ?? new Map<string, { release: string; code_commit?: string }>();
    map.set(app, code_commit === undefined ? { release } : { release, code_commit });
    lagging.set(computer, map);
  }

  function clearLagging(computer: string, app: string) {
    lagging.get(computer)?.delete(app);
  }

  /** The local `rel_*` token `computer` uses for `one` (may differ per computer for the same `code_commit`). */
  function releaseFor(computer: string, one: Installed): string {
    const screens = listed.get(computer)?.get(one.app);
    if (screens !== undefined && compareRelease(screenRelease(screens[0]), installedRelease(one)) === 0) {
      return screens[0].release;
    }
    return one.computer_releases?.[computer] ?? one.release;
  }

  /** Connected computers that know about `app` (associated in `installed.computers` or currently listing it). */
  function connectedFor(app: string, one: Installed): string[] {
    const result: string[] = [];
    for (const computer of remotes.keys()) {
      if (one.computers.includes(computer) || listed.get(computer)?.has(app)) {
        result.push(computer);
      }
    }
    return result;
  }

  /** Finds the connected computer listing `app` with the newest release. */
  function newestListing(app: string, preferred?: string): { computer: string; screens: Screens } | null {
    let best: { computer: string; screens: Screens } | null = null;
    const consider = (computer: string) => {
      if (!remotes.has(computer)) return;
      const screens = listed.get(computer)?.get(app);
      if (screens === undefined) return;
      if (best === null || compareRelease(screenRelease(screens[0]), screenRelease(best.screens[0])) > 0) {
        best = { computer, screens };
      }
    };
    if (preferred !== undefined) consider(preferred);
    for (const computer of remotes.keys()) {
      if (computer !== preferred) consider(computer);
    }
    return best;
  }

  async function installOne(app: string, preferred?: string) {
    const candidate = newestListing(app, preferred);
    const known = readInstalled(files, app);
    if (known !== null) {
      if (candidate !== null) {
        const computers = withComputer(known.computers, candidate.computer);
        if (computers !== known.computers) {
          writeInstalled(files, { ...known, computers });
          publish();
        }
      }
      return;
    }
    if (candidate === null) return;
    const ctx = await context(candidate.computer);
    if (ctx === null) return;
    busy.set(app, "installing");
    failures.delete(app);
    publish();
    const done = await install(ctx, candidate.screens);
    busy.delete(app);
    if (!done.ok) fail(app, done.error, done.error.step);
    publish();
    if (done.ok && done.value.kind === "sync") {
      // Pull from any other already-connected computers that also list this app at the active release.
      for (const other of remotes.keys()) {
        if (other !== candidate.computer && listed.get(other)?.has(app)) {
          scheduleSync(app, other);
        }
      }
    }
  }

  // `again`: a new snapshot of the same release (pull from `preferred` said snapshot_needed).
  async function switchOne(app: string, preferred?: string, again = false) {
    const one = readInstalled(files, app);
    if (one === null) return;
    let target: { computer: string; screens: Screens } | null = null;
    if (again && preferred !== undefined) {
      const screens = listed.get(preferred)?.get(app);
      if (
        screens !== undefined &&
        remotes.has(preferred) &&
        compareRelease(screenRelease(screens[0]), installedRelease(one)) >= 0
      ) {
        target = { computer: preferred, screens };
      }
    } else {
      const best = newestListing(app, preferred);
      if (best !== null && compareRelease(screenRelease(best.screens[0]), installedRelease(one)) > 0) {
        target = best;
      }
    }
    if (target === null) return;
    const ctx = await context(target.computer);
    if (ctx === null) return;
    busy.set(app, "installing");
    publish();
    await untilUnmounted(app);
    const latest = readInstalled(files, app);
    if (latest === null) {
      busy.delete(app);
      publish();
      return;
    }
    if (!again && compareRelease(screenRelease(target.screens[0]), installedRelease(latest)) <= 0) {
      busy.delete(app);
      publish();
      return;
    }
    const done = await switchRelease(ctx, latest, target.screens);
    busy.delete(app);
    if (done.ok) {
      failures.delete(app);
      clearLagging(target.computer, app);
    } else {
      fail(app, done.error);
      if (done.error.code === "conflict") reloads.get(target.computer)?.();
    }
    await countPending(app);
    publish();
    if (done.ok && done.value.kind === "sync") scheduleSyncAll(app);
  }

  async function syncOne(app: string, computer: string) {
    const ctx = await context(computer);
    if (ctx === null) return;
    let one = readInstalled(files, app);
    if (one === null || one.kind !== "sync") return;
    if (isLagging(computer, one)) return;
    busy.set(app, "syncing");
    publish();
    try {
      const targetRelease = releaseFor(computer, one);
      const pushed = await push(ctx, one, targetRelease);
      if (!pushed.ok) {
        if (pushed.error.code === "conflict") {
          const active = pushed.error.details?.["active_release"];
          const activeCommit = pushed.error.details?.["active_code_commit"];
          if (
            typeof active === "string" &&
            typeof activeCommit === "string" &&
            one.code_commit !== undefined &&
            activeCommit === one.code_commit
          ) {
            writeInstalled(files, {
              ...one,
              computers: withComputer(one.computers, computer),
              computer_releases: withComputerRelease(one.computer_releases, computer, active),
            });
            reloads.get(computer)?.();
          } else if (
            typeof active === "string" &&
            compareRelease(
              {
                release: active,
                ...(typeof activeCommit === "string" ? { code_commit: activeCommit } : {}),
              },
              { release: one.release, code_commit: one.code_commit },
            ) < 0
          ) {
            recordLagging(
              computer,
              app,
              active,
              typeof activeCommit === "string" ? activeCommit : undefined,
            );
          } else {
            reloads.get(computer)?.();
          }
        } else if (pushed.error.code !== "unavailable") {
          fail(app, pushed.error);
        }
        return;
      }
      one = readInstalled(files, app) ?? one;
      const pulled = await pull(ctx, one, releaseFor(computer, one));
      if (!pulled.ok) {
        if (pulled.error.code !== "unavailable") fail(app, pulled.error);
        return;
      }
      if (pulled.value.snapshot_needed) {
        const screens = listed.get(computer)?.get(app);
        if (screens === undefined) {
          reloads.get(computer)?.();
          return;
        }
        const cmp = compareRelease(screenRelease(screens[0]), installedRelease(one));
        if (cmp < 0) {
          recordLagging(computer, app, screens[0].release, screens[0].code_commit);
          return;
        }
        busy.delete(app);
        await switchOne(app, computer, cmp === 0);
        return;
      }
      clearLagging(computer, app);
      writeInstalled(files, {
        ...one,
        computers: withComputer(one.computers, computer),
        computer_releases: withComputerRelease(one.computer_releases, computer, releaseFor(computer, one)),
        last_synced_at: new Date(deps.now()).toISOString(),
      });
      failures.delete(app);
    } finally {
      busy.delete(app);
      await countPending(app);
      publish();
    }
  }

  function scheduleSync(app: string, computer: string) {
    if (!remotes.has(computer)) return;
    const key = `${app}\0${computer}`;
    if (syncQueued.has(key)) return;
    syncQueued.add(key);
    void queued(app, () => {
      syncQueued.delete(key);
      return syncOne(app, computer);
    });
  }

  function scheduleSyncAll(app: string) {
    const one = readInstalled(files, app);
    if (one === null || one.kind !== "sync") return;
    for (const computer of connectedFor(app, one)) {
      if (!isLagging(computer, one)) scheduleSync(app, computer);
    }
  }

  function syncComputer(computer: string) {
    for (const one of listInstalled(files)) {
      if (one.kind !== "sync") continue;
      if (one.computers.includes(computer) || listed.get(computer)?.has(one.app)) {
        if (!isLagging(computer, one)) scheduleSync(one.app, computer);
      }
    }
  }

  async function dropComputersFromSyncApp(app: string, drop: (computer: string) => boolean) {
    const one = readInstalled(files, app);
    if (one === null || one.kind !== "sync") return;
    const remaining = one.computers.filter((c) => !drop(c));
    if (remaining.length === one.computers.length) return;
    if (remaining.length > 0) {
      writeInstalled(files, {
        ...one,
        computers: remaining,
        computer_releases: dropComputerReleases(one.computer_releases, drop),
      });
      publish();
      return;
    }
    if ((mounts.get(app) ?? 0) > 0) return;
    if (await pruneApp(deps, app)) {
      pending.delete(app);
      publish();
    }
  }

  migrateLegacyFolders(deps);
  publish();
  // A fresh store (the phone app started again) knows of no pending change until it counts them: without this, a sync
  // app opened with its computers away said "synced" while its outbox still held changes.
  for (const one of listInstalled(files)) {
    if (one.kind === "sync") void countPending(one.app).then(publish);
  }

  return {
    get: () => apps,
    forComputer(computer) {
      const cached = byComputer.get(computer);
      if (cached !== undefined) return cached;
      const computerListed = listed.get(computer);
      const filtered = apps.filter((one) => {
        const record = installed.get(one.app);
        if (record !== undefined) {
          return record.computers.includes(computer) || (computerListed?.has(one.app) ?? false);
        }
        return computerListed?.has(one.app) ?? false;
      });
      byComputer.set(computer, filtered);
      return filtered;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    installed: (app) => installed.get(app) ?? null,
    absolute: (path) => files.absolute(path),
    connect(computer, next) {
      if (next === null) {
        if (!remotes.has(computer)) return;
        remotes.delete(computer);
        lagging.delete(computer);
        return;
      }
      if (remotes.get(computer) === next) return;
      remotes.set(computer, next);
      syncComputer(computer);
      // The list can come before the connection is handed over (they come from different places), and then could not
      // install or upgrade.
      const computerListed = listed.get(computer);
      if (computerListed !== undefined) {
        for (const [app, entries] of computerListed) {
          const one = readInstalled(files, app);
          if (one === null) void queued(app, () => installOne(app, computer));
          else if (compareRelease(screenRelease(entries[0]), installedRelease(one)) > 0) {
            void queued(app, () => switchOne(app, computer));
          }
        }
      }
    },
    list(computer, screens, reload) {
      reloads.set(computer, reload);
      const byApp = new Map<string, Screens>();
      for (const screen of screens) {
        if (!runsOnPhone(screen)) continue;
        const before = byApp.get(screen.app);
        byApp.set(screen.app, before === undefined ? [screen] : [...before, screen]);
      }
      listed.set(computer, byApp);
      lagging.delete(computer);
      for (const [app, entries] of byApp) {
        const one = readInstalled(files, app);
        if (one === null) {
          void queued(app, () => installOne(app, computer));
          continue;
        }
        const computers = withComputer(one.computers, computer);
        const cmp = compareRelease(screenRelease(entries[0]), installedRelease(one));
        const computer_releases =
          cmp === 0
            ? withComputerRelease(one.computer_releases, computer, entries[0].release)
            : one.computer_releases;
        const code_commit = one.code_commit ?? (cmp === 0 ? entries[0].code_commit : undefined);
        // The grants of the release already installed follow the computer that listed it last.
        const installedScreens = cmp === 0 ? withPhoneCapabilities(one.screens, entries) : one.screens;
        if (
          computers !== one.computers ||
          computer_releases !== one.computer_releases ||
          code_commit !== one.code_commit ||
          installedScreens !== one.screens
        ) {
          writeInstalled(files, {
            ...one,
            screens: installedScreens,
            ...(code_commit === undefined ? {} : { code_commit }),
            ...(computer_releases === undefined ? {} : { computer_releases }),
            computers,
          });
        }
        if (cmp > 0) {
          void queued(app, () => switchOne(app, computer));
        } else if (cmp === 0 && one.kind === "sync") {
          scheduleSync(app, computer);
        }
      }
      for (const one of listInstalled(files)) {
        if (one.kind !== "sync" || !one.computers.includes(computer) || byApp.has(one.app)) continue;
        void queued(one.app, async () => {
          if (listed.get(computer)?.has(one.app)) return;
          await dropComputersFromSyncApp(one.app, (c) => c === computer);
        });
      }
      publish();
    },
    forget(paired) {
      const keep = new Set(paired);
      for (const computer of [...remotes.keys()]) {
        if (!keep.has(computer)) remotes.delete(computer);
      }
      for (const computer of [...listed.keys()]) {
        if (!keep.has(computer)) listed.delete(computer);
      }
      for (const computer of [...reloads.keys()]) {
        if (!keep.has(computer)) reloads.delete(computer);
      }
      for (const computer of [...lagging.keys()]) {
        if (!keep.has(computer)) lagging.delete(computer);
      }
      for (const one of listInstalled(files)) {
        if (one.kind !== "sync") continue;
        if (!one.computers.some((c) => !keep.has(c))) continue;
        void queued(one.app, () => dropComputersFromSyncApp(one.app, (c) => !keep.has(c)));
      }
      publish();
    },
    install(app, computer) {
      failures.delete(app);
      void queued(app, () => installOne(app, computer));
    },
    syncNow: (app) => scheduleSyncAll(app),
    localChange(app) {
      void countPending(app).then(publish);
      scheduleSyncAll(app);
    },
    changed: (computer, app) => scheduleSync(app, computer),
    async external(computer, app, send) {
      const ctx = await context(computer);
      if (ctx === null) return unavailable("the computer is not reachable");
      const pushed = await queued(app, async () => {
        const one = readInstalled(files, app);
        return one === null ? null : push(ctx, one, releaseFor(computer, one));
      });
      void countPending(app).then(publish);
      if (pushed === null || !pushed.ok) {
        return unavailable(pushed?.error.message ?? "the app is not installed");
      }
      if (pushed.value.left > 0) return unavailable("local changes are not on the computer yet");
      const outcome = await send();
      scheduleSync(app, computer);
      return outcome;
    },
    mount(app) {
      mounts.set(app, (mounts.get(app) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const left = (mounts.get(app) ?? 1) - 1;
        mounts.set(app, left);
        if (left > 0) return;
        const waiting = unmounted.get(app) ?? [];
        unmounted.delete(app);
        for (const resolve of waiting) resolve();
      };
    },
  };
}
