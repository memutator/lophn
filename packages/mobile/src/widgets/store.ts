// The phone's side of home screen widgets: which computer, app and key each placed widget shows (bindings), the last value
// read from the computers (cache), and when to read again. The native widget draws from the two files without JS, so
// everything it shows is written here. Best effort: a refresh that cannot reach a computer leaves its widgets as they were,
// marked stale.
import { useEffect } from "react";
import { AppState } from "react-native";
import { type AppWidget, appWidgetsList } from "../../../protocol/apps/widget.ts";
import type { CoreReply } from "../connection/connection.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import { callOnce, type Computers, type ComputerData } from "../data/mod.ts";
import { loadComputers, deviceKey, type Computer } from "../pairing/store.ts";
import type { KeyPair } from "../remote.ts";
import {
  type Binding,
  type Bindings,
  buildCache,
  type Cache,
  EMPTY_BINDINGS,
} from "./cache.ts";
import { type WidgetNative, widgetNative } from "./native.ts";

const LIST = {
  kind: appWidgetsList.kind,
  resource: appWidgetsList.resource,
  method: appWidgetsList.method,
};
const BINDINGS = "widgets/bindings.json";
const CACHE = "widgets/cache.json";
// Per computer. A broadcast that starts a background refresh is allowed about ten seconds.
const CALL_MS = 8000;
// What `StateChanged` says about a widget's value, an app's name or a release dropping a widget.
const WATCHED = new Set(["widgets", "apps", "releases"]);

/** What a running app knows: which computers it holds and the connections that are up. Absent when the app is dead. */
export type Live = {
  known(host: string): boolean;
  core(host: string): CoreSource | undefined;
};

export type WidgetDeps = {
  native: WidgetNative;
  paired(): Promise<Computer[]>;
  phone(): Promise<KeyPair>;
  once(computer: Computer, phone: KeyPair, timeoutMs: number): Promise<CoreReply>;
  now(): number;
  time(ms: number): string;
};

function parse<T>(text: string | null, empty: T): T {
  if (text === null) return empty;
  try {
    return JSON.parse(text) as T;
  } catch {
    return empty;
  }
}

export function createWidgetStore(deps: WidgetDeps) {
  const { native } = deps;
  let live: Live | null = null;
  let running: Promise<void> | null = null;
  // Asked for while a refresh runs: asked once more after it, for these computers (null: all).
  let again: { hosts: Set<string> | null } | null = null;
  let lock: Promise<unknown> = Promise.resolve();

  // Bindings are read, changed and written by two callers (the refresh drops widgets the launcher lost, a bind adds one).
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn);
    lock = run.catch(() => {});
    return run;
  }

  const readBindings = async () =>
    parse<Bindings>(await native.readText(BINDINGS), EMPTY_BINDINGS);

  async function listOf(
    host: string,
    computer: Computer,
  ): Promise<readonly AppWidget[] | null> {
    const core = live?.core(host);
    const reply = core
      ? await Promise.race([
          core.call({ ...LIST, body: {} }),
          new Promise<CoreReply>((resolve) =>
            setTimeout(() => resolve({ ok: false }), CALL_MS),
          ),
        ]).catch((): CoreReply => ({ ok: false }))
      : await deps
          .once(computer, await deps.phone(), CALL_MS)
          .catch((): CoreReply => ({ ok: false }));
    const parsed = reply.ok ? appWidgetsList.output.safeParse(reply.value) : null;
    return parsed?.success ? parsed.data.widgets : null;
  }

  async function pass(hosts: Set<string> | null) {
    const bindings = await exclusive(async () => {
      const placed = new Set(await native.placedIds());
      const all = await readBindings();
      const kept = Object.entries(all.widgets).filter(([id]) =>
        placed.has(Number(id)),
      );
      if (kept.length === Object.keys(all.widgets).length) return all;
      const left: Bindings = { v: 1, widgets: Object.fromEntries(kept) };
      await native.writeText(BINDINGS, JSON.stringify(left));
      return left;
    });
    // The saved list is written a moment after the person removes a computer; the running app already knows.
    const computers = (await deps.paired()).filter(
      (one) => !one.revoked && (live === null || live.known(one.key)),
    );
    const bound = new Set(Object.values(bindings.widgets).map((one) => one.host));
    const lists = new Map<string, readonly AppWidget[] | null>();
    await Promise.all(
      computers
        .filter((one) => bound.has(one.key) && (hosts === null || hosts.has(one.key)))
        .map(async (one) => {
          lists.set(one.key, await listOf(one.key, one));
        }),
    );
    const before = await native.readText(CACHE);
    const cache = buildCache({
      bindings,
      paired: new Set(computers.map((one) => one.key)),
      lists,
      previous: parse<Cache | null>(before, null),
      now: deps.now(),
      time: deps.time,
    });
    const text = JSON.stringify(cache);
    if (text === before) return;
    await native.writeText(CACHE, text);
    await native.redraw();
  }

  /**
   * Reads the widgets of the computers some placed widget shows (`hosts` narrows it), writes the cache and draws again.
   * Calls that come while one runs share it and run once more after it. Never rejects: whoever waits is a background task
   * that has to end.
   */
  function refresh(reason: string, hosts?: readonly string[]): Promise<void> {
    if (running !== null) {
      if (again === null) again = { hosts: hosts ? new Set(hosts) : null };
      else if (again.hosts !== null) {
        if (hosts) for (const host of hosts) again.hosts.add(host);
        else again.hosts = null;
      }
      return running;
    }
    running = (async () => {
      let next: Set<string> | null = hosts ? new Set(hosts) : null;
      for (;;) {
        await pass(next).catch((error) => console.warn(`widget refresh (${reason})`, error));
        if (again === null) break;
        next = again.hosts;
        again = null;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    refresh,
    attach(next: Live | null) {
      live = next;
    },
    /** Pins a placed widget to one app widget of one computer and reads its value. */
    async bind(id: number, binding: Binding) {
      await exclusive(async () => {
        const bindings = await readBindings();
        bindings.widgets[String(id)] = binding;
        await native.writeText(BINDINGS, JSON.stringify(bindings));
      });
      void refresh("bind", [binding.host]);
    },
    /** Forgets the bindings of widgets the launcher no longer has. */
    async unbindMissing() {
      await refresh("unbind", []);
    },
  };
}

const store = createWidgetStore({
  native: widgetNative,
  paired: loadComputers,
  phone: deviceKey,
  once: (computer, phone, timeoutMs) =>
    callOnce(
      computer,
      phone,
      { ...LIST, body: {} },
      timeoutMs,
    ),
  now: Date.now,
  time: (ms) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
});

export const bindWidget = store.bind;
export const unbindMissing = store.unbindMissing;
export const refreshWidgets = store.refresh;

/** The task native starts (`LophnWidgetRefresh`) when the launcher asks a widget to update and the app may be dead. */
export const refreshWidgetsInBackground = () => store.refresh("background");

/**
 * Mount once at the app root. Refreshes when the app comes forward and when it goes to the background (the widget is what
 * the person sees next), while connected when a computer says a widget, an app or a release changed, and when a computer
 * is removed.
 */
export function useWidgetRefresh(computers: Computers<ComputerData>) {
  useEffect(() => {
    store.attach({
      known: (host) => computers.get().computers.some((one) => one.key === host),
      core: (host) => {
        const link = computers.link(host);
        return link?.state().status === "connected" ? link.data.core : undefined;
      },
    });
    const listening = new Map<string, { link: unknown; off: () => void }>();
    let hosts = new Set<string>();
    const follow = () => {
      const keys = new Set(computers.get().computers.map((one) => one.key));
      if ([...hosts].some((key) => !keys.has(key))) void store.refresh("computers", []);
      hosts = keys;
      for (const key of keys) {
        const link = computers.link(key);
        if (link === undefined || listening.get(key)?.link === link) continue;
        listening.get(key)?.off();
        const off = link.data.client.subscribe({ types: ["StateChanged"] }, (message) => {
          if (
            message.kind === "event" &&
            message.event.type === "StateChanged" &&
            message.event.payload.changes.some((one) => WATCHED.has(one.name))
          ) {
            void store.refresh("changed", [key]);
          }
        });
        listening.set(key, { link, off });
      }
      for (const [key, one] of listening) {
        if (keys.has(key)) continue;
        one.off();
        listening.delete(key);
      }
    };
    follow();
    const off = computers.subscribe(follow);
    void store.refresh("open");
    const app = AppState.addEventListener(
      "change",
      (state) => void store.refresh(state === "active" ? "front" : "back"),
    );
    return () => {
      app.remove();
      off();
      for (const one of listening.values()) one.off();
      store.attach(null);
    };
  }, [computers]);
}
