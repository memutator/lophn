// The apps of one computer that run on the phone, and the host's sync work on them, without React Native. Work on one
// app runs one step at a time (install, sync, release change, prune); different apps run side by side.
//
// Sync runs only while the computer is reachable (`connect`) and something on screen holds the store (the phone app is
// in front). Its cues: a local change, the connection coming back, AppSyncChanged, a list read, `syncNow`. One sync is
// push then pull. A release change (push `conflict`, a new release in the list, pull `snapshot_needed`) first waits
// for the app's guest to go (`mount`).
import type { PhoneScreen } from "../../data/apps.ts";
import type { CallOutcome } from "../guest/mod.ts";
import { outboxCount, withDb } from "./db.ts";
import {
  type Installed,
  kindOf,
  type LocalKind,
  listInstalled,
  paths,
  readInstalled,
  runsOnPhone,
  writeInstalled,
} from "./folder.ts";
import { type Ctx, install } from "./install.ts";
import type { LocalDeps, Remote } from "./ports.ts";
import { pruneApp } from "./prune.ts";
import { switchRelease } from "./release.ts";
import { pull, push } from "./sync.ts";

export type LocalAppState = "ready" | "installing" | "syncing" | "failed";

export interface LocalApp {
  readonly app: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: LocalKind;
  readonly release: string;
  /** When push and pull last both went through; null for a standalone app. */
  readonly last_synced_at: string | null;
  /** Local changes the computer does not have yet. */
  readonly pending: number;
  readonly state: LocalAppState;
  /** Why the last install, sync or release change did not go through (for the developer). */
  readonly failure?: string;
}

type Screens = readonly [PhoneScreen, ...PhoneScreen[]];

export interface LocalAppsDeps extends LocalDeps {
  readonly computer: string;
  /** This phone's id on the computer (the sync node). */
  node(): Promise<string>;
}

export interface LocalApps {
  get(): readonly LocalApp[];
  subscribe(listener: () => void): () => void;
  /** What is installed for an app (its files), or null. */
  installed(app: string): Installed | null;
  /** The absolute path of a path in the app folders (folder.ts). */
  absolute(path: string): string;
  /** The computer is reachable through `remote`, or not (null). */
  connect(remote: Remote | null): void;
  /**
   * The computer's `apps/phone_screens` list, read while it is reachable. Installs the apps that run on the phone,
   * moves installed ones to a new release, and prunes the ones that left. `reload` reads the list again.
   */
  list(screens: readonly PhoneScreen[], reload: () => void): void;
  install(app: string): void;
  syncNow(app: string): void;
  /** A guest's local call committed a change. */
  localChange(app: string): void;
  /** AppSyncChanged for the app. */
  changed(app: string): void;
  /** An external operation: the outbox goes first; when it cannot, the call is not sent and is `unavailable`. */
  external(app: string, send: () => Promise<CallOutcome>): Promise<CallOutcome>;
  /** A guest of the app is mounted until the returned function runs. A release change waits for none. */
  mount(app: string): () => void;
}

const unavailable = (message: string): CallOutcome => ({
  ok: false,
  error: { code: "unavailable", message },
});

export function createLocalApps(deps: LocalAppsDeps): LocalApps {
  const { files, computer } = deps;
  let remote: Remote | null = null;
  let listed = new Map<string, Screens>();
  let reloadList = () => {};
  const busy = new Map<string, "installing" | "syncing">();
  const failures = new Map<string, string>();
  const pending = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  const syncQueued = new Set<string>();
  const mounts = new Map<string, number>();
  const unmounted = new Map<string, (() => void)[]>();
  const listeners = new Set<() => void>();
  let installed = new Map<string, Installed>();
  let apps: readonly LocalApp[] = [];

  function publish() {
    installed = new Map(listInstalled(files, computer).map((one) => [one.app, one]));
    const out: LocalApp[] = [];
    const stateOf = (app: string): LocalAppState =>
      busy.get(app) ?? (failures.has(app) ? "failed" : "ready");
    const failure = (app: string) => (failures.has(app) ? { failure: failures.get(app)! } : {});
    for (const one of installed.values()) {
      out.push({
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
    // Apps being installed, or whose install failed.
    for (const [app, screens] of listed) {
      if (installed.has(app) || (!busy.has(app) && !failures.has(app))) continue;
      const first = screens[0];
      out.push({
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
    apps = out;
    for (const listener of [...listeners]) listener();
  }

  function queued<T>(app: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(app) ?? Promise.resolve()).then(work);
    const settled = run.catch((thrown: unknown) => {
      failures.set(app, thrown instanceof Error ? thrown.message : String(thrown));
      busy.delete(app);
      publish();
    });
    queues.set(app, settled);
    return run;
  }

  async function context(): Promise<Ctx | null> {
    if (remote === null) return null;
    return { deps, remote, computer, node: await deps.node() };
  }

  async function countPending(app: string) {
    const one = readInstalled(files, computer, app);
    if (one === null || one.kind !== "sync") return;
    pending.set(app, await withDb(deps, paths(computer, app).db, outboxCount));
  }

  function untilUnmounted(app: string): Promise<void> {
    if ((mounts.get(app) ?? 0) === 0) return Promise.resolve();
    return new Promise((resolve) => {
      unmounted.set(app, [...(unmounted.get(app) ?? []), resolve]);
    });
  }

  async function installOne(app: string) {
    const screens = listed.get(app);
    if (screens === undefined || readInstalled(files, computer, app) !== null) return;
    const ctx = await context();
    if (ctx === null) return;
    busy.set(app, "installing");
    failures.delete(app);
    publish();
    const done = await install(ctx, screens);
    busy.delete(app);
    if (!done.ok) failures.set(app, done.error.message);
    publish();
  }

  // `again`: a new snapshot of the same release (pull said snapshot_needed).
  async function switchOne(app: string, screens: Screens, again = false) {
    const one = readInstalled(files, computer, app);
    const ctx = await context();
    if (one === null || ctx === null) return;
    if (!again && one.release === screens[0].release) return;
    busy.set(app, "installing");
    publish();
    await untilUnmounted(app);
    const done = await switchRelease(ctx, one, screens);
    busy.delete(app);
    if (done.ok) failures.delete(app);
    else {
      failures.set(app, done.error.message);
      if (done.error.code === "conflict") reloadList();
    }
    await countPending(app);
    publish();
    if (done.ok && done.value.kind === "sync") scheduleSync(app);
  }

  async function syncOne(app: string) {
    const ctx = await context();
    if (ctx === null) return;
    let one = readInstalled(files, computer, app);
    if (one === null || one.kind !== "sync") return;
    busy.set(app, "syncing");
    publish();
    try {
      const pushed = await push(ctx, one);
      if (!pushed.ok) {
        if (pushed.error.code === "conflict") reloadList();
        else if (pushed.error.code !== "unavailable") failures.set(app, pushed.error.message);
        return;
      }
      one = readInstalled(files, computer, app) ?? one;
      const pulled = await pull(ctx, one);
      if (!pulled.ok) {
        if (pulled.error.code !== "unavailable") failures.set(app, pulled.error.message);
        return;
      }
      if (pulled.value.snapshot_needed) {
        const screens = listed.get(app);
        if (screens === undefined) reloadList();
        else {
          busy.delete(app);
          await switchOne(app, screens, true);
        }
        return;
      }
      writeInstalled(files, computer, {
        ...one,
        last_synced_at: new Date(deps.now()).toISOString(),
      });
      failures.delete(app);
    } finally {
      busy.delete(app);
      await countPending(app);
      publish();
    }
  }

  function scheduleSync(app: string) {
    if (remote === null || syncQueued.has(app)) return;
    syncQueued.add(app);
    void queued(app, () => {
      syncQueued.delete(app);
      return syncOne(app);
    });
  }

  function syncAll() {
    for (const one of listInstalled(files, computer)) {
      if (one.kind === "sync") scheduleSync(one.app);
    }
  }

  publish();

  return {
    get: () => apps,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    installed: (app) => installed.get(app) ?? null,
    absolute: (path) => files.absolute(path),
    connect(next) {
      if (next === remote) return;
      remote = next;
      if (remote !== null) syncAll();
    },
    list(screens, reload) {
      reloadList = reload;
      const byApp = new Map<string, Screens>();
      for (const screen of screens) {
        if (!runsOnPhone(screen)) continue;
        const before = byApp.get(screen.app);
        byApp.set(screen.app, before === undefined ? [screen] : [...before, screen]);
      }
      listed = byApp;
      for (const [app, entries] of listed) {
        const one = readInstalled(files, computer, app);
        if (one === null) void queued(app, () => installOne(app));
        else if (one.release !== entries[0].release) void queued(app, () => switchOne(app, entries));
      }
      for (const one of listInstalled(files, computer)) {
        if (listed.has(one.app)) continue;
        void queued(one.app, async () => {
          if ((mounts.get(one.app) ?? 0) > 0 || listed.has(one.app)) return;
          if (await pruneApp(deps, computer, one.app)) publish();
        });
      }
      publish();
    },
    install(app) {
      failures.delete(app);
      void queued(app, () => installOne(app));
    },
    syncNow: (app) => scheduleSync(app),
    localChange(app) {
      void countPending(app).then(publish);
      scheduleSync(app);
    },
    changed: (app) => scheduleSync(app),
    async external(app, send) {
      const ctx = await context();
      if (ctx === null) return unavailable("the computer is not reachable");
      const pushed = await queued(app, async () => {
        const one = readInstalled(files, computer, app);
        return one === null ? null : push(ctx, one);
      });
      void countPending(app).then(publish);
      if (pushed === null || !pushed.ok) {
        return unavailable(pushed?.error.message ?? "the app is not installed");
      }
      if (pushed.value.left > 0) return unavailable("local changes are not on the computer yet");
      const outcome = await send();
      scheduleSync(app);
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
