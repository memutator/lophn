// The phone's ports: `files/apps/` through expo-file-system (synchronous writes) and the app database module's host
// connection.
import { Directory, File, Paths } from "expo-file-system";
import { openHost } from "../../../modules/lophn-app-db/index.ts";
import { pathOf } from "../guest/files.ts";
import type { LocalDeps, LocalFiles } from "./ports.ts";

const root = () => new Directory(Paths.document, "apps");
const fileAt = (path: string) => new File(root(), ...path.split("/"));
const folderAt = (path: string) => (path === "" ? root() : new Directory(root(), ...path.split("/")));

function made(path: string): File {
  const file = fileAt(path);
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  return file;
}

export const localFiles: LocalFiles = {
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
    fileAt(from).moveSync(made(to), { overwrite: true });
  },
  async digest(path) {
    const file = fileAt(path);
    if (!file.exists) return null;
    return { size: file.size, sha256: (await file.digest("SHA-256")).toLowerCase() };
  },
  absolute: (path) => pathOf(fileAt(path)),
};

export const nativeDeps: LocalDeps = {
  files: localFiles,
  open: (path) => openHost(path),
  now: Date.now,
};
