import { Directory, File, Paths } from "expo-file-system";
import type { BundleFiles } from "./bundle.ts";
import { pathOf } from "./guest/files.ts";

// phone-screens/ in the app's files folder (where the guest's base bundle also sits).
const root = () => new Directory(Paths.document, "phone-screens");
const fileAt = (path: string) => new File(root(), ...path.split("/"));
const entryAt = (path: string) =>
  path === "" ? root() : new Directory(root(), ...path.split("/"));

export function bundleFiles(): BundleFiles {
  return {
    exists: (path) => fileAt(path).exists,
    readText(path) {
      const file = fileAt(path);
      return file.exists ? file.textSync() : null;
    },
    write(path, content) {
      const file = fileAt(path);
      file.parentDirectory.create({ idempotent: true, intermediates: true });
      file.writeSync(content);
    },
    remove(path) {
      const file = fileAt(path);
      if (file.exists) {
        file.delete();
        return;
      }
      const folder = entryAt(path);
      if (folder.exists) folder.delete();
    },
    list(path) {
      const folder = entryAt(path);
      return folder.exists ? folder.list().map((entry) => entry.name) : [];
    },
    absolute: (path) => pathOf(fileAt(path)),
  };
}
