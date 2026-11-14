import { Directory, File, Paths } from "expo-file-system";
import type { BundleStore } from "./cache.ts";

// remote-ui/<computer key>/ under the app's own files. The key is base64url text, safe as a folder name.
const folder = (computer: string) =>
  new Directory(Paths.document, "remote-ui", computer);

// The absolute path the native WebView serves (`root`); it takes a plain path, not a file:// uri.
export function bundleRoot(computer: string, name: string): string {
  return decodeURIComponent(
    new Directory(folder(computer), name).uri.replace(/^file:\/\//, ""),
  ).replace(/\/$/, "");
}

export function forgetBundles(computer: string): void {
  const dir = folder(computer);
  if (dir.exists) dir.delete();
}

export function bundleStore(computer: string): BundleStore {
  const root = folder(computer);
  const at = (path: string) => new File(root, path);
  const dirAt = (path: string) => new Directory(root, path);
  return {
    exists: (path) => at(path).exists || dirAt(path).exists,
    readText: (path) => (at(path).exists ? at(path).textSync() : undefined),
    writeText(path, text) {
      const file = at(path);
      if (!file.exists) file.create({ intermediates: true });
      file.writeSync(text);
    },
    async writeBase64(path, base64) {
      const file = at(path);
      file.create({ intermediates: true, overwrite: true });
      await file.write(base64, { encoding: "base64" });
    },
    sha256: async (path) => (await at(path).digest("SHA-256")).toLowerCase(),
    move(from, to) {
      dirAt(from).rename(to);
    },
    remove(path) {
      const file = at(path);
      const dir = dirAt(path);
      if (dir.exists) dir.delete();
      else if (file.exists) file.delete();
    },
    list: () => (root.exists ? root.list().map((entry) => entry.name) : []),
  };
}
