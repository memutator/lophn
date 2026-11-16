// The phone screen bundle cache, without React Native: a screen's phone.js (a live release's or a running preview's) is
// taken from its computer only when this phone can run it, kept only when its bytes match the manifest, and kept under
// its bundle_hash (the bytes are fixed by it, so a hash once kept is never taken again). Per app the two newest bundles
// stay; an app gone from the list and a computer gone from the phone lose theirs.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { appScreenFile } from "../../../protocol/apps/calls/screen.ts";
import {
  type PhoneHostInfo,
  phoneCanRun,
} from "../../../protocol/apps/phone-screen.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import type { PhoneScreen } from "../data/apps.ts";

/** The cache folder (phone-screens/ in the app's files folder); paths are relative to it and use `/`. */
export interface BundleFiles {
  exists(path: string): boolean;
  /** null when there is no such file. */
  readText(path: string): string | null;
  /** Makes the folders on the way. */
  write(path: string, content: Uint8Array | string): void;
  /** A file or a whole folder; nothing when it is not there. */
  remove(path: string): void;
  /** Names in a folder; empty when it is not there. */
  list(path: string): string[];
  /** The absolute path the guest's loader reads. */
  absolute(path: string): string;
}

export type BundleRefusal = "phone_too_old" | "screen_too_old";

export type Bundle =
  | { readonly ok: true; readonly file: string }
  | {
      readonly ok: false;
      /** refused: this phone and the screen do not fit, nothing was taken. mismatch: the bytes were not the manifest's. */
      readonly reason: BundleRefusal | "unavailable" | "mismatch";
    };

// Newest bundle hashes per app, newest first. A preview's are kept apart under `<app>#preview`, so rebuilt previews do
// not push out the live release's bundle while its screen may still start again from it.
type Index = Record<string, string[]>;
const KEEP = 2;
const PREVIEW = "#preview";
const appOf = (key: string) => key.split("#")[0]!;

const indexPath = (computer: string) => `${computer}/apps.json`;
const bundlePath = (computer: string, hash: string) => `${computer}/${hash}`;

function readIndex(files: BundleFiles, computer: string): Index {
  try {
    const parsed = JSON.parse(files.readText(indexPath(computer)) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// Removes the folders of hashes no list keeps (a preview of the live release has the live bundle's hash).
function drop(files: BundleFiles, computer: string, index: Index, hashes: readonly string[]) {
  const kept = new Set(Object.values(index).flat());
  for (const old of hashes) if (!kept.has(old)) files.remove(bundlePath(computer, old));
}

function keep(files: BundleFiles, computer: string, key: string, hash: string) {
  const index = readIndex(files, computer);
  const hashes = [hash, ...(index[key] ?? []).filter((one) => one !== hash)];
  index[key] = hashes.slice(0, KEEP);
  drop(files, computer, index, hashes.slice(KEEP));
  files.write(indexPath(computer), JSON.stringify(index));
}

function bytesOf(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at);
  return bytes;
}

/** A screen's bundle: a live release's, or a running preview's, taken by its process. */
export type BundleScreen = Pick<PhoneScreen, "app" | "screen" | "bundle_hash" | "manifest"> &
  ({ readonly release: string } | { readonly process_nonce: string });

/** The screen's phone.js on this phone: from the cache, or taken from the computer and checked against its manifest. */
export async function prepareBundle(
  deps: {
    core: Pick<CoreSource, "call">;
    files: BundleFiles;
    host: PhoneHostInfo;
  },
  computer: string,
  screen: BundleScreen,
): Promise<Bundle> {
  const fits = phoneCanRun(screen.manifest, deps.host);
  if (!fits.ok) return { ok: false, reason: fits.reason };
  const path = `${bundlePath(computer, screen.bundle_hash)}/${screen.screen}/phone.js`;
  if (!deps.files.exists(path)) {
    const reply = await deps.core
      .call({
        kind: appScreenFile.kind,
        resource: appScreenFile.resource,
        method: appScreenFile.method,
        body: {
          target:
            "process_nonce" in screen
              ? { mode: "preview", app: screen.app, process_nonce: screen.process_nonce }
              : { mode: "live", app: screen.app, release: screen.release },
          screen: screen.screen,
          path: "phone.js",
        },
      })
      .catch(() => null);
    if (reply === null || !reply.ok) return { ok: false, reason: "unavailable" };
    const bytes = bytesOf((reply.value as { base64: string }).base64);
    if (
      bytes.byteLength !== screen.manifest.size ||
      bytesToHex(sha256(bytes)) !== screen.manifest.sha256
    ) {
      return { ok: false, reason: "mismatch" };
    }
    deps.files.write(path, bytes);
  }
  keep(
    deps.files,
    computer,
    "process_nonce" in screen ? `${screen.app}${PREVIEW}` : screen.app,
    screen.bundle_hash,
  );
  return { ok: true, file: deps.files.absolute(path) };
}

/** Drops the bundles of the computer's apps that are no longer in its list. */
export function forgetApps(
  files: BundleFiles,
  computer: string,
  apps: readonly string[],
): void {
  const index = readIndex(files, computer);
  const gone = Object.keys(index).filter((key) => !apps.includes(appOf(key)));
  if (gone.length === 0) return;
  const hashes = gone.flatMap((key) => index[key] ?? []);
  for (const key of gone) delete index[key];
  drop(files, computer, index, hashes);
  files.write(indexPath(computer), JSON.stringify(index));
}

/** Drops the bundles of computers this phone no longer has. */
export function forgetComputers(
  files: BundleFiles,
  computers: readonly string[],
): void {
  for (const name of files.list("")) {
    if (!computers.includes(name)) files.remove(name);
  }
}
