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
