// The raw screen of a terminal on the computer (`terminal_view/*`): a coding session's terminal or one the phone opened.
// Opening and typing are the core's `terminals/open|input`, the same routes the desktop uses.
// The core keeps only the latest screen and says that it changed (`TerminalScreenChanged`, no content); the phone reads
// the snapshot again. Watching is a lease the phone renews every 10 seconds; the core drops it 30 seconds after the last
// renewal, so a phone that went away stops the host from pushing screens without saying so. The phone sizes the terminal
// to its own screen when it claims (the last device that claimed wins; the computer claims back when its tab gets focus),
// and the computer's tab takes its own size back when no phone watches any more.
import type { z } from "zod";
import {
  terminalViewResize,
  terminalViewSnapshot,
  terminalViewWatch,
} from "../../../protocol/coding-agent/terminal-view.ts";
import { terminalsInput, terminalsOpen } from "../../../protocol/coding-agent/terminals.ts";
import type { SourceResult } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { CodingResult } from "./coding.ts";
import type {
  EventClient,
  EventMessage,
} from "../../../shell/renderer/desktop/connection/events/client.ts";
import { newId } from "../../../shell/renderer/prefixed-id.ts";

export type TerminalSnapshot = z.output<(typeof terminalViewSnapshot)["output"]>;
export type TerminalLine = TerminalSnapshot["lines"][number];
export type TerminalRun = TerminalLine["runs"][number];

export interface TerminalState {
  /** The latest screen read; kept while the terminal is gone or the computer is away. */
  readonly screen: TerminalSnapshot | null;
  /**
   * loading: no screen yet. gone: the coding session's terminal closed (`not_found`). offline: the computer or its lophn
   * app does not answer.
   */
  readonly status: "loading" | "ready" | "gone" | "offline";
}

export const TERMINAL_LOADING: TerminalState = {
  screen: null,
  status: "loading",
};

export const LEASE_EVERY_MS = 10_000;

/** Calls `run` every `ms` until the returned function is called. */
export type Every = (ms: number, run: () => void) => () => void;

export interface TerminalFeed {
  /** Types into the terminal. Only when the snapshot said `input`; the core refuses it otherwise. */
  send(text: string): Promise<SourceResult<void>>;
  /** Claims the terminal's size for this phone: now if watching, and again each time the watch starts over. */
  resize(columns: number, rows: number): void;
  /** Stops watching: drops the lease now instead of letting it run out. */
  stop(): void;
}

async function call<T>(
  client: EventClient,
  route: { kind: string; resource: string; method: string },
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await client.core.call({
      kind: route.kind as "read" | "memory",
      resource: route.resource,
      method: route.method,
      body,
    });
    return reply.ok
      ? { ok: true, value: reply.value as T }
      : { ok: false, code: reply.error?.code ?? "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/**
 * Watches one terminal from now until `stop`: takes the lease when the event watch is ready (first time and after every
 * reconnect) and renews it every 10 seconds while connected, and reads the snapshot after each and on every change of
 * this terminal. Changes that arrive while a read is on its way make one more read after it, not one each.
 */
export function terminalFeed(
  client: EventClient,
  terminal: string,
  every: Every,
  onChange: (state: TerminalState) => void,
): TerminalFeed {
  let state = TERMINAL_LOADING;
  let stopped = false;
  let reading = false;
  let again = false;
  let renewing: (() => void) | null = null;
  let leased = false;
  let size: { columns: number; rows: number } | null = null;

  function set(next: TerminalState) {
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
      const done = await call<TerminalSnapshot>(client, terminalViewSnapshot, {
        terminal,
      });
      if (done.ok) set({ screen: done.value, status: "ready" });
      else if (done.code === "not_found")
        set({ screen: state.screen, status: "gone" });
      // unavailable: the host has not pushed the first screen yet; its change brings it.
    } while (again && !stopped);
    reading = false;
  }

  /** Takes or renews the lease. */
  async function lease() {
    const done = await call(client, terminalViewWatch, { terminal, on: true });
    leased = done.ok;
    if (!done.ok) {
      set({
        screen: state.screen,
        status: done.code === "not_found" ? "gone" : "offline",
      });
    }
  }

  /** The core takes a size only from a phone that watches. */
  async function claim() {
    if (size === null || !leased || stopped) return;
    await call(client, terminalViewResize, { terminal, ...size });
  }

  function onMessage(message: EventMessage) {
    if (stopped) return;
    if (message.kind === "ready") {
      // Every renewal reads the screen too: whether this phone may type changes on the computer without an event.
      // Only a new watch claims the size; a renewal must not take it back from the computer.
      renewing ??= every(LEASE_EVERY_MS, () => void lease().then(read));
      void lease().then(claim).then(read);
    } else if (message.kind === "disconnected") {
      renewing?.();
      renewing = null;
      leased = false;
      set({ screen: state.screen, status: "offline" });
    } else if (
      message.event.type === "TerminalScreenChanged" &&
      message.event.payload.terminal === terminal
    ) {
      void read();
    }
  }

  const unsubscribe = client.subscribe(
    { types: ["TerminalScreenChanged"] },
    onMessage,
  );

  return {
    async send(text) {
      const done = await call(client, terminalsInput, {
        terminal,
        text,
        key: newId("input"),
      });
      return done.ok ? { ok: true, value: undefined } : done;
    },
    resize(columns, rows) {
      size = { columns, rows };
      void claim();
    },
    stop() {
      stopped = true;
      unsubscribe();
      renewing?.();
      renewing = null;
      void call(client, terminalViewWatch, { terminal, on: false });
    },
  };
}

/**
 * Opens a shell in the project's folder on the computer (a tab too, in a window that shows the project, if one does) and
 * gives its terminal, to watch with `terminalFeed`. A refusal carries the computer's sentence. The same `key` opens it once.
 */
export async function openTerminal(
  client: EventClient,
  project: string,
  key: string = newId("open"),
): Promise<CodingResult<string>> {
  try {
    const reply = await client.core.call({
      kind: terminalsOpen.kind as "memory",
      resource: terminalsOpen.resource,
      method: terminalsOpen.method,
      body: { project, key, tab: { relation: null } },
    });
    return reply.ok
      ? { ok: true, value: (reply.value as { terminal: string }).terminal }
      : {
          ok: false,
          code: reply.error?.code ?? "unavailable",
          ...(reply.error?.message === undefined
            ? {}
            : { message: reply.error.message }),
        };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
