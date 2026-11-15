// One computer's copy of the remote screen bundle (`remote_ui/manifest`, `remote_ui/file`).
// Each bundle sits in a folder named by the manifest hash, and only after every file matched its hash.
// `current` names the bundle the WebView shows; it changes only when a whole new bundle is confirmed.
import { z } from "zod";
import type { CoreCall, CoreReply } from "../connection/connection.ts";

// Paths are relative to the computer's cache folder, `/`-separated.
export type BundleStore = {
  exists(path: string): boolean;
  readText(path: string): string | undefined;
  writeText(path: string, text: string): void;
  // Writes the decoded bytes, creating parent folders.
  writeBase64(path: string, base64: string): Promise<void>;
  // sha256 of the file's bytes, lowercase hex.
  sha256(path: string): Promise<string>;
  move(from: string, to: string): void;
  remove(path: string): void;
  // Names directly in the cache folder.
  list(): string[];
};

const CURRENT = "current";
const STAGING = "staging";
export const BUNDLE_ENTRY = "index.html";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
// Only plain relative paths: the files are written under the staging folder.
const path = z
  .string()
  .refine((p) => p.split("/").every((s) => s !== "" && s !== "." && s !== ".."));
const manifestSchema = z.object({
  hash,
  files: z.array(z.object({ path, hash })),
});
const fileSchema = z.object({ base64: z.string() });

export function currentBundle(store: BundleStore): string | undefined {
  const name = store.readText(CURRENT)?.trim();
  return name && store.exists(name) ? name : undefined;
}

/**
 * Brings the cache up to the core's bundle. Returns the confirmed bundle's folder name, or undefined
 * when the manifest or any file could not be read or did not match (then nothing new is kept).
 */
export async function syncBundle(
  call: (input: CoreCall) => Promise<CoreReply>,
  store: BundleStore,
): Promise<string | undefined> {
  const reply = await call({
    kind: "memory",
    resource: "remote_ui",
    method: "manifest",
    body: {},
  });
  const manifest = reply.ok ? manifestSchema.safeParse(reply.value) : undefined;
  if (!manifest?.success) return undefined;
  const { hash: name, files } = manifest.data;
  if (!files.some((file) => file.path === BUNDLE_ENTRY)) return undefined;

  if (!store.exists(name)) {
    store.remove(STAGING);
    // A file that cannot be read, written or does not match its hash drops the whole bundle.
    const fetched = async (file: { path: string; hash: string }) => {
      const got = await call({
        kind: "file",
        resource: "remote_ui",
        method: "file",
        body: { path: file.path },
      });
      const body = got.ok ? fileSchema.safeParse(got.value) : undefined;
      if (!body?.success) return false;
      const at = `${STAGING}/${file.path}`;
      try {
        await store.writeBase64(at, body.data.base64);
        return (await store.sha256(at)) === file.hash;
      } catch {
        return false;
      }
    };
    for (const file of files) {
      if (!(await fetched(file))) {
        store.remove(STAGING);
        return undefined;
      }
    }
    store.move(STAGING, name);
  }

  // Keep the new bundle and the one shown before it; the page may still be loading files from the old one.
  const previous = currentBundle(store);
  store.writeText(CURRENT, name);
  for (const entry of store.list()) {
    if (entry !== CURRENT && entry !== name && entry !== previous) {
      store.remove(entry);
    }
  }
  return name;
}
