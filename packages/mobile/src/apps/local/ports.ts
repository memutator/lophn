// What the phone host's sync work touches, as ports: the app folders, the app database, the computer. The phone fills
// them with expo-file-system, modules/lophn-app-db and the computer's connection (native.ts); the node tests with
// node:fs, node:sqlite and a fake computer.
import type { SyncDb } from "../../../../protocol/apps/sync/db.ts";

/** `files/apps/` in the app's files folder. Paths are relative to it and use `/`. */
export interface LocalFiles {
  exists(path: string): boolean;
  /** null when there is no such file. */
  readText(path: string): string | null;
  /** Makes the folders on the way. */
  write(path: string, content: Uint8Array | string): void;
  /** Adds to the end of the file, making it (and its folders) when missing. */
  append(path: string, bytes: Uint8Array): void;
  /** A file or a whole folder; nothing when it is not there. */
  remove(path: string): void;
  /** Names in a folder; empty when it is not there. */
  list(path: string): string[];
  /** Replaces `to`. */
  copy(from: string, to: string): void;
  /** Replaces `to`. */
  move(from: string, to: string): void;
  /** Size and sha256 (hex) of the bytes on disk; null when there is no such file. */
  digest(path: string): Promise<{ size: number; sha256: string } | null>;
  /** The absolute path the database module and the guest's loader take. */
  absolute(path: string): string;
}

/** The host's connection to an app database (modules/lophn-app-db `openHost`). */
export type HostDb = SyncDb & { close(): void };

/** A reply from the computer (the CoreSource reply, with the error details the routes give). */
export type Reply =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details?: Record<string, unknown>;
      };
    };

export interface Remote {
  call(input: {
    kind: "read" | "command" | "memory" | "upload" | "file";
    resource: string;
    method: string;
    body: unknown;
  }): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;
}

export interface LocalDeps {
  files: LocalFiles;
  /** Opens (and creates) a database file by absolute path. */
  open(path: string): HostDb;
  now(): number;
}
