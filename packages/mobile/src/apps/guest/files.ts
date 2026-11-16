import { Directory, File, Paths } from "expo-file-system";

// The base bundle ships in the APK assets (written there by guest/build-base.sh during the gradle build). The sandbox
// loads scripts by file path, so the host copies it into the files folder; base.json (its sha256) tells when the APK
// carries a different one.
const dir = () => new Directory(Paths.document, "guest");

// An absolute path, the form the sandbox's loader takes.
export const pathOf = (entry: File | Directory) =>
  decodeURI(entry.uri.replace(/^file:\/\//, "")).replace(/\/$/, "");

export const basePath = () => pathOf(new File(dir(), "base.hbc"));

export function fileExists(path: string): boolean {
  return new File(`file://${path}`).exists;
}

export async function ensureBase(): Promise<string> {
  // The wrapped backend copies of the last run (wrapBackend); no guest is mounted yet.
  const copies = new Directory(Paths.cache, "guest");
  if (copies.exists) copies.delete();
  const folder = dir();
  folder.create({ idempotent: true, intermediates: true });
  const stamp = await new File("asset:///guest/base.json").text();
  const base = new File(folder, "base.hbc");
  const local = new File(folder, "base.json");
  if (base.exists && local.exists && (await local.text()) === stamp) {
    return pathOf(base);
  }
  if (local.exists) local.delete();
  if (base.exists) base.delete();
  await new File("asset:///guest/base.hbc").copy(base);
  await local.write(stamp);
  return pathOf(base);
}

// backend.js runs between the base and the screen. Core builds it as a plain iife, so an exception while it evaluates
// would reach React Native before the guest catches anything and end the runtime as `crashed`. The guest runs a copy
// wrapped the way core wraps a screen bundle, which ends it as `fatal` with the app's message instead. One copy per
// mount, removed at the next app start (ensureBase): removed on unmount, it could go before the loader read it.
export function wrapBackend(backendFile: string, origin: string): string {
  const source = new File(`file://${backendFile}`).textSync();
  const folder = new Directory(Paths.cache, "guest");
  folder.create({ idempotent: true, intermediates: true });
  const copy = new File(folder, `${origin.replace(/[^\w.-]/g, "_")}.js`);
  copy.writeSync(`try{\n${source}\n}catch(e){globalThis.__lophnFatal(e)}\n`);
  return pathOf(copy);
}
