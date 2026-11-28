// bundle된 `platform/dist/*.mjs`와 개발용 raw `.ts`에서 같은 방식으로 platform root·자산·진입점을 찾는다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  findPlatformRoot,
  type PlatformEntryName,
  resolvePlatformEntry,
} from "../../base/mod.ts";

const DEPS = { exists: existsSync, dirname, join };
const ROOT_CACHE = new Map<string, string>();

export function platformRootFrom(metaUrl: string): string {
  const cached = ROOT_CACHE.get(metaUrl);
  if (cached !== undefined) return cached;
  const root = findPlatformRoot(dirname(fileURLToPath(metaUrl)), DEPS);
  ROOT_CACHE.set(metaUrl, root);
  return root;
}

export function platformPath(metaUrl: string, ...parts: string[]): string {
  return join(platformRootFrom(metaUrl), ...parts);
}

export function platformUrl(metaUrl: string, ...parts: string[]): URL {
  return pathToFileURL(platformPath(metaUrl, ...parts));
}

export function platformEntry(
  metaUrl: string,
  name: PlatformEntryName,
): string {
  return resolvePlatformEntry(platformRootFrom(metaUrl), name, DEPS);
}

export function platformEntryUrl(
  metaUrl: string,
  name: PlatformEntryName,
): URL {
  return pathToFileURL(platformEntry(metaUrl, name));
}
