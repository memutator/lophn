// One live connection per viewed machine, opened when the list is read and kept while the app runs. Electron main has the
// standard global WebSocket (Node 24), which `dialWebSocket` uses.
import type { RandomSource } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { KeyPair } from "../../../../protocol/remote/client.ts";
import {
  type Announced,
  type Computer,
  type Connection,
  createConnection,
  dialWebSocket,
  type Link,
  linkStateOf,
  unpair,
} from "../../../../remote-client/mod.ts";

export type LinkDeps = {
  random: RandomSource;
  now: () => number;
  wait: (ms: number, fn: () => void) => () => void;
  // The idempotency key of the unpair command.
  newKey: () => string;
  // The machine became connected or stopped being connected, at `at` (ISO). Only on those transitions.
  seen: (machine: Id<"mch">, at: string) => void;
};

export function openLink(
  computer: Computer,
  key: KeyPair,
  on: {
    name: string;
    onRevoked: () => void;
    onPeer: (machine: Announced) => void;
  },
  deps: LinkDeps,
): Link<Connection> {
  let machine = computer.machine;
  const connection = createConnection({
    endpoint: computer,
    key,
    dial: dialWebSocket,
    random: deps.random,
    name: on.name,
    capabilities: [],
    now: deps.now,
    wait: deps.wait,
    onRevoked: on.onRevoked,
    onPeer: (peer) => {
      machine = peer.id;
      on.onPeer(peer);
    },
  });
  // Subscribed before the computer store subscribes, so the store's list already has the new time.
  let connected = false;
  connection.subscribe((state) => {
    const now = state.state === "ready";
    if (now === connected) return;
    connected = now;
    if (machine !== undefined) {
      deps.seen(machine, new Date(deps.now()).toISOString());
    }
  });
  return {
    data: connection,
    state: () => linkStateOf(connection, 0),
    subscribe: (listener) => connection.subscribe(() => listener()),
    pause: () => connection.pause(),
    resume: () => connection.resume(),
    leave: () => unpair(connection, deps.newKey()),
    close: () => connection.close(),
  };
}
