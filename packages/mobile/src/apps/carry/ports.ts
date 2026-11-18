// What carrying touches, as ports: the carry folder and its database, the network kind, the time. The phone fills them
// with expo-file-system, modules/lophn-app-db and expo-network (native.ts); the node test with node:fs and node:sqlite.
import type { SyncDb } from "../../../../protocol/apps/sync/db.ts";

/** `carry/` in the app's documents folder. Paths are relative to it and use `/`. */
export interface CarryFiles {
  /** The whole file; null when there is none. */
  read(path: string): Uint8Array | null;
  /** Up to `length` bytes from `offset`. */
  readRange(path: string, offset: number, length: number): Uint8Array;
  /** Makes the folders on the way. */
  write(path: string, bytes: Uint8Array): void;
  /** Adds to the end of the file. */
  append(path: string, bytes: Uint8Array): void;
  /** Replaces `to`. */
  move(from: string, to: string): void;
  /** Nothing when it is not there. */
  remove(path: string): void;
}

export interface CarryDeps {
  files: CarryFiles;
  db: SyncDb;
  now(): number;
  /**
   * The biggest file carried now: the person's choice over a metered network (mobile data, or a kind the phone cannot
   * tell), no bound (Infinity) over Wi-Fi or ethernet. Manifests go whatever it is.
   */
  cap(): number;
}
