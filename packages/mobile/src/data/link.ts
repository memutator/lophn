// What one computer's screens read, built the way the desktop window builds it: the event client, its stores (sessions,
// Inbox) and the conversation source over a `CoreSource`. The phone's connection already has the CoreSource shape, so the desktop code
// runs on it unchanged. After a drop the connection sends the last watch again and the core answers `ready`; the event
// client then re-reads every snapshot (architecture/event.md).
import { coreAgentTabSourceFactory } from "../../../shell/renderer/conversation/agent-tab-core-source.ts";
import type { AgentTabSourceFactory } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  createEventClient,
  type EventClient,
} from "../../../shell/renderer/desktop/connection/events/client.ts";
import {
  createEventStores,
  type EventStores,
} from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import {
  type createConnection,
  type Link,
  leave,
  linkStateOf,
} from "../../../remote-client/mod.ts";
import { type Coding, codingOf } from "./coding.ts";
import { remoteImages } from "./images.ts";

export interface ComputerData {
  readonly core: CoreSource;
  readonly client: EventClient;
  // The sessions, Inbox and unseen stores. They run for every computer, not only the one on screen: the one list shows
  // every computer's sessions and the computer list what waits on each.
  readonly stores: EventStores;
  /** True once this computer's session store has published at least one snapshot (or event) since starting. */
  readonly sessionsSettled: {
    get(): boolean;
    subscribe(listener: () => void): () => void;
  };
  readonly sources: AgentTabSourceFactory;
  /** The computer's coding sessions: the conversation source of a chat-view one and the actions on them. */
  readonly coding: Coding;
  /**
   * The desk (the desktop sidebar's worktree group) a session sits in. Desks live in the desktop window's layout, which the
   * phone cannot read, so a real computer has none and its sessions form one group.
   */
  readonly deskOf?: (session: string) => string | null;
  /** Only the sample computer: switches the Weekly report conversation between its states. */
  readonly sample?: {
    conversation(state: SampleConversation): void;
  };
}

export type SampleConversation = "done" | "working" | "approval" | "question";

/** The event stores and conversation source over any CoreSource. The sample computer builds the same over its fake core. */
export function dataOf(
  core: CoreSource,
  sources: AgentTabSourceFactory = coreAgentTabSourceFactory(core, {
    images: remoteImages,
  }),
): { data: ComputerData; stop: () => void } {
  const client = createEventClient(core);
  const stores = createEventStores(client);
  let settled = false;
  const listeners = new Set<() => void>();
  const offSettled = stores.sessions.subscribe(() => {
    if (settled) return;
    settled = true;
    for (const listener of [...listeners]) listener();
  });
  const sessionsSettled = {
    get: () => settled,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const stopStores = stores.start();
  return {
    data: { core, client, stores, sessionsSettled, sources, coding: codingOf(client) },
    stop() {
      offSettled();
      stopStores();
    },
  };
}

export function linkOf(
  connection: ReturnType<typeof createConnection>,
): Link<ComputerData> {
  const { data, stop } = dataOf(connection);
  return {
    data,
    state: () => linkStateOf(connection, data.stores.waiting.get().count),
    subscribe(listener) {
      const offState = connection.subscribe(listener);
      const offWaiting = data.stores.waiting.subscribe(listener);
      return () => {
        offState();
        offWaiting();
      };
    },
    pause: () => connection.pause(),
    resume: () => connection.resume(),
    leave: () => leave(connection),
    sendRoster: (roster) => connection.sendRoster(roster),
    close() {
      stop();
      connection.close();
    },
  };
}
