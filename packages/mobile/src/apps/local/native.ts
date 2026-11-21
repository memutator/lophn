// The phone's ports: `files/apps/` through expo-file-system (synchronous writes) and the app database module's host
// connection.
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { openHost } from "../../../modules/lophn-app-db/index.ts";
import { pathOf } from "../guest/files.ts";
import type { LocalDeps, LocalFiles } from "./ports.ts";

/** The files under one folder (paths are relative to it). `files/apps/` holds the apps that run on the phone; the cache holds the files of apps that run on a computer. */
export function filesUnder(root: () => Directory): LocalFiles {
  const fileAt = (path: string) => new File(root(), ...path.split("/"));
  const folderAt = (path: string) => (path === "" ? root() : new Directory(root(), ...path.split("/")));
  function made(path: string): File {
    const file = fileAt(path);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    return file;
  }
  return {
    exists: (path) => fileAt(path).exists || folderAt(path).exists,
    readText(path) {
      const file = fileAt(path);
      return file.exists ? file.textSync() : null;
    },
    write(path, content) {
      made(path).writeSync(content);
    },
    append(path, bytes) {
      const file = made(path);
      if (!file.exists) file.create();
      file.writeSync(bytes, { append: true });
    },
    remove(path) {
      const file = fileAt(path);
      if (file.exists) {
        file.delete();
        return;
      }
      const folder = folderAt(path);
      if (folder.exists) folder.delete();
    },
    list(path) {
      const folder = folderAt(path);
      return folder.exists ? folder.list().map((entry) => entry.name) : [];
    },
    copy(from, to) {
      fileAt(from).copySync(made(to), { overwrite: true });
    },
    move(from, to) {
      const folder = folderAt(from);
      if (folder.exists) {
        const dest = folderAt(to);
        dest.parentDirectory.create({ idempotent: true, intermediates: true });
        if (dest.exists) dest.delete();
        folder.moveSync(dest);
        return;
      }
      fileAt(from).moveSync(made(to), { overwrite: true });
    },
    async digest(path) {
      const file = fileAt(path);
      if (!file.exists) return null;
      return { size: file.size, sha256: (await file.digest("SHA-256")).toLowerCase() };
    },
    absolute: (path) => pathOf(fileAt(path)),
    readRange(path, offset, length) {
      const handle = fileAt(path).open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return handle.readBytesSync(length);
      } finally {
        handle.close();
      }
    },
    async copyIn(source, path) {
      await new File(source).copy(made(path));
    },
    uri: (path) => fileAt(path).uri,
  };
}

export const localFiles: LocalFiles = filesUnder(() => new Directory(Paths.document, "apps"));

/** The cache: the OS may take it back, so nothing there is the only copy of anything. */
export const cacheFiles: LocalFiles = filesUnder(() => new Directory(Paths.cache, "app-files"));

export const nativeDeps: LocalDeps = {
  files: localFiles,
  open: (path) => openHost(path),
  now: Date.now,
};
