// The computer's browser pages as the phone sees them (`page_view/*`): the list, and one page's picture and state while
// its screen is open. The same shape as the terminal (`terminal.ts`): watching is a lease the phone renews every
// PAGE_VIEW_RENEW_MS; while it holds, the computer pushes pictures, the core keeps only the latest and says that it changed
// (`PageViewChanged`, no content), and the phone reads the snapshot again. The core lets the next picture go only after
// the phone read the last one, so on a slow link pictures are skipped rather than queued.
// Using the page (input, take control, opening one) is for a phone the computer lets type in terminals; `control` in the
// list and in the snapshot says whether this one may.
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  PAGE_VIEW_RENEW_MS,
  type PageInput,
  pageViewControl,
  pageViewInput,
  pageViewList,
  pageViewOpen,
  pageViewSnapshot,
  pageViewWatch,
} from "../../../protocol/lophn-agent/page-view.ts";
import type { SourceResult } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import {
  type ReadHandle,
  readRoute,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import type {
  EventClient,
  EventMessage,
} from "../../../shell/renderer/desktop/connection/events/client.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import type { Every } from "./terminal.ts";

export type PageSnapshot = z.output<(typeof pageViewSnapshot)["output"]>;
/** The pages, and whether this phone may use them (open one, type, take control). */
export type PageList = z.output<(typeof pageViewList)["output"]>;
export type PageItem = PageList["pages"][number];

export interface PageState {
  /** The latest snapshot read; kept while the page is gone or the computer is away. */
  readonly snapshot: PageSnapshot | null;
  /** gone: the page closed on the computer (`not_found`). offline: the computer or its lophn app does not answer. */
  readonly status: "loading" | "ready" | "gone" | "offline";
}

export const PAGE_LOADING: PageState = { snapshot: null, status: "loading" };

export interface PageFeed {
  send(input: PageInput): Promise<SourceResult<void>>;
  /** Takes the page from its agent (true) or hands it back (false). */
  control(held: boolean): Promise<SourceResult<void>>;
  /** Stops watching: drops the lease now instead of letting it run out. */
  stop(): void;
}

async function call<T>(
  client: EventClient,
  route: Parameters<typeof readRoute>[1],
  body: unknown,
): Promise<SourceResult<T>> {
  const done = await readRoute(client.core, route, body as never).catch(
    () => ({ ok: false as const, code: "unavailable" }),
  );
  return done.ok
    ? { ok: true, value: done.value as T }
    : { ok: false, code: done.code ?? "unavailable" };
}

const nothing = (done: SourceResult<unknown>): SourceResult<void> =>
  done.ok ? { ok: true, value: undefined } : done;

/**
 * Watches one page from now until `stop`: takes the lease when the event watch is ready (first time and after every
 * reconnect), renews it while connected, and reads the snapshot after each and on every change of this page. Changes
 * that arrive while a read is on its way make one more read after it, not one each.
 */
export function pageFeed(
  client: EventClient,
  tab: string,
  every: Every,
  onChange: (state: PageState) => void,
): PageFeed {
  let state = PAGE_LOADING;
  let stopped = false;
  let reading = false;
  let again = false;
  let renewing: (() => void) | null = null;
  // Inputs go one after another: a press's down must reach the page before its up, typed text before the Enter after it.
  let queue: Promise<unknown> = Promise.resolve();

  function set(next: PageState) {
    if (stopped) return;
    state = next;
    onChange(next);
  }

  async function read() {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    do {
      again = false;
      const done = await call<PageSnapshot>(client, pageViewSnapshot, { tab });
      if (done.ok) set({ snapshot: done.value, status: "ready" });
      else if (done.code === "not_found")
        set({ snapshot: state.snapshot, status: "gone" });
    } while (again && !stopped);
    reading = false;
  }

  async function lease() {
    const done = await call(client, pageViewWatch, { tab, on: true });
    if (!done.ok) {
      set({
        snapshot: state.snapshot,
        status: done.code === "not_found" ? "gone" : "offline",
      });
    }
  }

  function onMessage(message: EventMessage) {
    if (stopped) return;
    if (message.kind === "ready") {
      // Every renewal reads the snapshot too: whether this phone may use the page changes on the computer without an event.
      renewing ??= every(PAGE_VIEW_RENEW_MS, () => void lease().then(read));
      void lease().then(read);
    } else if (message.kind === "disconnected") {
      renewing?.();
      renewing = null;
      set({ snapshot: state.snapshot, status: "offline" });
    } else if (
      message.event.type === "PageViewChanged" &&
      message.event.payload.tab === tab
    ) {
      void read();
    }
  }

  const unsubscribe = client.subscribe({ types: ["PageViewChanged"] }, onMessage);

  return {
    send(input) {
      const done = queue.then(() =>
        call(client, pageViewInput, { tab, key: newId("input"), input }),
      );
      queue = done;
      return done.then(nothing);
    },
    async control(held) {
      return nothing(await call(client, pageViewControl, { tab, held }));
    },
    stop() {
      stopped = true;
      unsubscribe();
      renewing?.();
      renewing = null;
      void call(client, pageViewWatch, { tab, on: false });
    },
  };
}

const everyInterval: Every = (ms, run) => {
  const timer = setInterval(run, ms);
  return () => clearInterval(timer);
};

export interface PageView extends PageState {
  send(input: PageInput): Promise<SourceResult<void>>;
  control(held: boolean): Promise<SourceResult<void>>;
}

/**
 * One page of the computer on screen, watched while `tab` is given; null watches nothing (the app is in the background).
 * The last snapshot stays while it is not watched.
 */
export function usePage(tab: string | null): PageView {
  const client = useEventClient();
  const [state, setState] = useState<PageState>(PAGE_LOADING);
  const feed = useRef<PageFeed | null>(null);
  useEffect(() => {
    if (tab === null) return;
    const watching = pageFeed(client, tab, everyInterval, setState);
    feed.current = watching;
    return () => {
      feed.current = null;
      watching.stop();
    };
  }, [client, tab]);
  const send = useCallback(
    (input: PageInput): Promise<SourceResult<void>> =>
      feed.current?.send(input) ??
      Promise.resolve({ ok: false, code: "unavailable" }),
    [],
  );
  const control = useCallback(
    (held: boolean): Promise<SourceResult<void>> =>
      feed.current?.control(held) ??
      Promise.resolve({ ok: false, code: "unavailable" }),
    [],
  );
  return { ...state, send, control };
}

/** The computer's browser pages, read again when one opens or closes and after a reconnect. */
export function usePages(): ReadHandle<PageList> {
  return useFollowedRead(
    (core) => readRoute(core, pageViewList, {}),
    ["browser_pages"],
    "page_view/list",
  );
}

/** Opens a page on the computer (`url` already has its scheme) and gives its tab, to watch with `usePage`. */
export function useOpenPage(): (url: string) => Promise<SourceResult<string>> {
  const client = useEventClient();
  return useCallback(
    async (url) => {
      const done = await call<{ tab: string }>(client, pageViewOpen, {
        url,
        key: newId("open"),
      });
      return done.ok ? { ok: true, value: done.value.tab } : done;
    },
    [client],
  );
}
