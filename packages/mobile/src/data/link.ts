// What one computer's screens read, built the way the desktop window builds it: the event client, the Inbox store and the
// conversation source over a `CoreSource`. The phone's connection already has the CoreSource shape, so the desktop code
// runs on it unchanged. After a drop the connection sends the last watch again and the core answers `ready`; the event
// client then re-reads every snapshot (architecture/event.md).
import { coreAgentTabSourceFactory } from "../../../shell/renderer/conversation/agent-tab-core-source.ts";
import type { AgentTabSourceFactory } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  createEventClient,
  type EventClient,
} from "../../../shell/renderer/desktop/connection/events/client.ts";
import { createWaitingStore } from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
import type { Connection } from "../connection/connection.ts";
import type { Link, LinkState } from "./computers.ts";
import { remoteImages } from "./images.ts";

export type WaitingStore = ReturnType<typeof createWaitingStore>;

export interface ComputerData {
  readonly core: CoreSource;
  readonly client: EventClient;
  // Kept for every computer, not only the one on screen, so the computer list can show what waits on each.
  readonly waiting: WaitingStore;
  readonly sources: AgentTabSourceFactory;
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

/** The Inbox store and conversation source over any CoreSource. The sample computer builds the same over its fake core. */
export function dataOf(
  core: CoreSource,
  sources: AgentTabSourceFactory = coreAgentTabSourceFactory(core, {
    images: remoteImages,
  }),
): { data: ComputerData; stop: () => void } {
  const client = createEventClient(core);
  const waiting = createWaitingStore(
    client,
    () => new Date().toISOString(),
    null,
  );
  return {
    data: { core, client, waiting, sources },
    stop: waiting.start(),
  };
}

const STATUS = {
  starting: "connecting",
  ready: "connected",
  stale: "offline",
} as const satisfies Record<
  ReturnType<Connection["current"]>["state"],
  LinkState["status"]
>;

export function linkOf(connection: Connection): Link<ComputerData> {
  const { data, stop } = dataOf(connection);
  return {
    data,
    state: () => ({
      status: STATUS[connection.current().state],
      path: connection.path(),
      waiting: data.waiting.get().count,
    }),
    subscribe(listener) {
      const offState = connection.subscribe(listener);
      const offWaiting = data.waiting.subscribe(listener);
      return () => {
        offState();
        offWaiting();
      };
    },
    pause: () => connection.pause(),
    resume: () => connection.resume(),
    close() {
      stop();
      connection.close();
    },
  };
}
