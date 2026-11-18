// The phone's carrier: the carry folder through expo-file-system, its database through modules/lophn-app-db, the
// network kind through expo-network, and the person's limit for mobile data in SecureStore (key `carry`, like the
// appearance). Made on first use and kept for the app's life.
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { openHost } from "../../../modules/lophn-app-db/index.ts";
import { pathOf } from "../guest/files.ts";
import { CARRY_LIMIT_DEFAULT } from "./carry.ts";
import { type Carrier, createCarrier } from "./carrier.ts";
import type { CarryFiles } from "./ports.ts";

const root = () => new Directory(Paths.document, "carry");
const fileAt = (path: string) => new File(root(), ...path.split("/"));

function made(path: string): File {
  const file = fileAt(path);
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  return file;
}

const files: CarryFiles = {
  read(path) {
    const file = fileAt(path);
    return file.exists ? file.bytesSync() : null;
  },
  readRange(path, offset, length) {
    const handle = fileAt(path).open(FileMode.ReadOnly);
    try {
      handle.offset = offset;
      return handle.readBytesSync(length);
    } finally {
      handle.close();
    }
  },
  write(path, bytes) {
    made(path).writeSync(bytes);
  },
  append(path, bytes) {
    fileAt(path).writeSync(bytes, { append: true });
  },
  move(from, to) {
    fileAt(from).moveSync(made(to), { overwrite: true });
  },
  remove(path) {
    const file = fileAt(path);
    if (file.exists) {
      file.delete();
      return;
    }
    const folder = new Directory(root(), ...path.split("/"));
    if (folder.exists) folder.delete();
  },
};

const KEY = "carry";
// Bytes; Infinity is "Any size" (saved as null).
let limit: number = CARRY_LIMIT_DEFAULT;
const limitListeners = new Set<() => void>();
// Until the phone says what network it is on, it is metered.
let metered = true;
let instance: Carrier | undefined;

export function carrier(): Carrier {
  if (instance !== undefined) return instance;
  root().create({ idempotent: true, intermediates: true });
  const one = createCarrier({
    files,
    db: openHost(pathOf(new File(root(), "carry.db"))),
    now: Date.now,
    cap: () => (metered ? limit : Infinity),
  });
  instance = one;
  const kind = (state: Network.NetworkState) => {
    const was = metered;
    metered =
      state.type !== Network.NetworkStateType.WIFI && state.type !== Network.NetworkStateType.ETHERNET;
    if (was && !metered) one.all();
  };
  void Network.getNetworkStateAsync().then(kind);
  Network.addNetworkStateListener(kind);
  void SecureStore.getItemAsync(KEY).then((saved) => {
    if (saved) setLimit((JSON.parse(saved) as { limit: number | null }).limit ?? Infinity, false);
  });
  return one;
}

function setLimit(next: number, save = true) {
  limit = next;
  for (const listener of limitListeners) listener();
  if (!save) return;
  void SecureStore.setItemAsync(KEY, JSON.stringify({ limit: Number.isFinite(next) ? next : null }));
  // A bigger limit can carry now what waited.
  instance?.all();
}

function subscribeLimit(listener: () => void) {
  limitListeners.add(listener);
  return () => {
    limitListeners.delete(listener);
  };
}

/** Settings: what the phone holds, and the biggest file it carries over mobile data. */
export function useCarry() {
  const one = carrier();
  const held = useSyncExternalStore(one.subscribe, one.holding);
  const current = useSyncExternalStore(subscribeLimit, () => limit);
  return { ...held, limit: current, setLimit: (next: number) => setLimit(next) };
}
