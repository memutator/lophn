import type { RandomSource } from "../../../packages/base/mod.ts";
import {
  connectRemote,
  type KeyPair,
  REMOTE_PATH,
  type RemoteClientChannel,
  type RemoteClientFrame,
  type RemoteServerFrame,
  type RemoteTransport,
  relayPhoneUrl,
  remoteKeyBytes,
} from "../remote.ts";

// Same shape as the desktop renderer's CoreSource (packages/shell/renderer/desktop/connection), so remote screens take either.
export type ConnectionState = {
  state: "starting" | "ready" | "stale";
  confirmedAt: number | null;
};
export type CoreCall = {
  kind?: string;
  resource: string;
  method: string;
  body: unknown;
};
export type CoreReply = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};
export type CoreEventMessage =
  | { kind: "ready" }
  | { kind: "event"; event: unknown }
  | {
      kind: "closed";
      reason: "slow_consumer" | "credential_revoked" | "shutdown";
    };
export type WatchConditions = Extract<
  RemoteClientFrame,
  { type: "watch" }
>["conditions"];

export type CoreSource = {
  subscribe(listener: (state: ConnectionState) => void): () => void;
  current(): ConnectionState;
  call(input: CoreCall): Promise<CoreReply>;
  watch(conditions: WatchConditions): Promise<void>;
  onEvent(listener: (message: CoreEventMessage) => void): () => void;
};

// Which way the open channel goes: straight to one of the computer's addresses, or through its relay.
export type ConnectionPath = "direct" | "relay";

export type Connection = CoreSource & {
  // Path of the open channel; null while not connected.
  path(): ConnectionPath | null;
  // App went to the background: stop retrying. The open socket is left to the OS.
  pause(): void;
  // App came back: connect now if not connected.
  resume(): void;
  close(): void;
};

// Where a paired computer listens. `key` is the core's public key text from the QR; `relay` is its relay, if it has one.
export type Endpoint = {
  addresses: string[];
  port: number;
  key: string;
  relay?: string;
};

export type Dial = (url: string) => Promise<RemoteTransport>;

type Common = { phone: KeyPair; dial: Dial; random: RandomSource };

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
// How long a resumed channel has to answer the re-sent watch before it counts as dead.
const PROBE_MS = 3000;

type Opened = { channel: RemoteClientChannel; path: ConnectionPath };

// Dials every address and the relay at once and keeps the first that finishes the handshake; the rest are closed.
// The relay only passes bytes, so the Noise handshake is the same on every path.
export function openFirst(
  endpoint: Endpoint,
  deps: Common,
): Promise<Opened | undefined> {
  const remoteStatic = remoteKeyBytes(endpoint.key);
  const urls: { url: string; path: ConnectionPath }[] = endpoint.addresses.map(
    (address) => ({
      url: `ws://${address.includes(":") ? `[${address}]` : address}:${endpoint.port}${REMOTE_PATH}`,
      path: "direct",
    }),
  );
  if (endpoint.relay) {
    urls.push({
      url: relayPhoneUrl(endpoint.relay, endpoint.key),
      path: "relay",
    });
  }
  if (!remoteStatic || urls.length === 0) return Promise.resolve(undefined);
  const open = async (url: string) => {
    const transport = await deps.dial(url).catch(() => undefined);
    if (!transport) return undefined;
    const channel = await connectRemote({
      transport,
      staticKey: deps.phone,
      remoteStatic,
      capabilities: [],
      random: deps.random,
    });
    return channel.ok ? channel.value : undefined;
  };
  return new Promise((resolve) => {
    let left = urls.length;
    let won = false;
    for (const { url, path } of urls) {
      void open(url).then((channel) => {
        left -= 1;
        if (channel && !won) {
          won = true;
          resolve({ channel, path });
        } else {
          channel?.close();
          if (left === 0 && !won) resolve(undefined);
        }
      });
    }
  });
}

export function createConnection(
  deps: Common & {
    endpoint: Endpoint;
    now: () => number;
    // Runs fn after ms; returns a cancel function.
    wait: (ms: number, fn: () => void) => () => void;
    onRevoked: () => void;
  },
): Connection {
  let state: ConnectionState = { state: "starting", confirmedAt: null };
  let channel: RemoteClientChannel | undefined;
  let path: ConnectionPath | null = null;
  let connecting = false;
  let active = true;
  let stopped = false;
  let failures = 0;
  let cancelRetry: (() => void) | undefined;
  let cancelProbe: (() => void) | undefined;
  // Last conditions the screen asked for. Sent again on every new channel; `[]` still gets a `ready` back.
  let watching: WatchConditions = [];
  let nextId = 0;
  const pending = new Map<string, (reply: CoreReply) => void>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const eventListeners = new Set<(message: CoreEventMessage) => void>();

  function setState(next: ConnectionState) {
    state = next;
    for (const listener of stateListeners) listener(next);
  }

  function emit(message: CoreEventMessage) {
    for (const listener of eventListeners) listener(message);
  }

  function retry() {
    if (!active || stopped || cancelRetry) return;
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** failures, BACKOFF_MAX_MS);
    failures += 1;
    cancelRetry = deps.wait(delay, () => {
      cancelRetry = undefined;
      void connect();
    });
  }

  async function connect() {
    if (connecting || channel || !active || stopped) return;
    connecting = true;
    const opened = await openFirst(deps.endpoint, deps);
    connecting = false;
    if (!opened) {
      setState({ state: "stale", confirmedAt: state.confirmedAt });
      return retry();
    }
    if (stopped) return opened.channel.close();
    channel = opened.channel;
    path = opened.path;
    channel.onClose(() => dropped(opened.channel));
    channel.onFrame(received);
    channel.send({ type: "watch", conditions: watching });
  }

  function lose() {
    channel = undefined;
    path = null;
    cancelProbe?.();
    cancelProbe = undefined;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({
        ok: false,
        error: { code: "unavailable", message: "connection closed" },
      });
    }
    if (!stopped) setState({ state: "stale", confirmedAt: state.confirmedAt });
  }

  function dropped(closed: RemoteClientChannel) {
    if (channel !== closed) return;
    lose();
    retry();
  }

  // After the background the socket may have died without a close event. The core answers a watch with `ready`;
  // if that does not come in time, drop the channel and connect again now instead of waiting for a backoff.
  function probe(current: RemoteClientChannel) {
    current.send({ type: "watch", conditions: watching });
    cancelProbe = deps.wait(PROBE_MS, () => {
      cancelProbe = undefined;
      if (channel !== current) return;
      lose();
      current.close();
      void connect();
    });
  }

  function received(frame: RemoteServerFrame) {
    if (frame.type === "result") {
      const resolve = pending.get(frame.id);
      if (!resolve) return;
      pending.delete(frame.id);
      resolve(
        frame.ok
          ? { ok: true, value: frame.value }
          : { ok: false, error: frame.error },
      );
    } else if (frame.type === "ready") {
      cancelProbe?.();
      cancelProbe = undefined;
      failures = 0;
      setState({ state: "ready", confirmedAt: deps.now() });
      emit({ kind: "ready" });
    } else if (frame.type === "event") {
      emit({ kind: "event", event: frame.event });
    } else if (frame.type === "closed") {
      if (frame.reason === "credential_revoked") {
        stopped = true;
        deps.onRevoked();
      }
      emit({ kind: "closed", reason: frame.reason });
    }
  }

  void connect();

  return {
    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    current: () => state,
    path: () => path,
    call(input) {
      if (!channel) {
        return Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "not connected" },
        });
      }
      const id = `c${++nextId}`;
      const sent = channel.send({
        type: "call",
        id,
        resource: input.resource,
        method: input.method,
        body: input.body,
      });
      if (!sent.ok) return Promise.resolve({ ok: false, error: sent.error });
      return new Promise((resolve) => pending.set(id, resolve));
    },
    watch(conditions) {
      watching = conditions;
      channel?.send({ type: "watch", conditions });
      return Promise.resolve();
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    pause() {
      active = false;
      cancelRetry?.();
      cancelRetry = undefined;
    },
    resume() {
      active = true;
      failures = 0;
      cancelRetry?.();
      cancelRetry = undefined;
      if (channel && !cancelProbe) probe(channel);
      else void connect();
    },
    close() {
      stopped = true;
      cancelRetry?.();
      cancelRetry = undefined;
      channel?.close();
    },
  };
}
