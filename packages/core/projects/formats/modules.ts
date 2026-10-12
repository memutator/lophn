// 옛 Version의 module은 hash로만 찾는다. 이름으로 최신 module을 찾지 않는다.
import { moduleHash } from "./guest/bundle.ts";
import { BUNDLE_PATH } from "./guest/contract.ts";

export type StoredModule = {
  hash: string;
  bundle: string;
};

export type ModuleLookup =
  | { found: true; module: StoredModule }
  | { found: false; reason: "missing" };

let cached: StoredModule | undefined;

export async function builtinModule(): Promise<StoredModule> {
  if (cached !== undefined) return cached;
  const bundle = await Deno.readTextFile(BUNDLE_PATH);
  cached = { hash: moduleHash(bundle), bundle };
  return cached;
}

// 보존된 module 목록. 없는 hash는 누락이고, 최신 hash로 대체하지 않는다.
export async function findModule(
  hash: string,
  preserved: readonly StoredModule[] = [],
): Promise<ModuleLookup> {
  const builtin = await builtinModule();
  const modules = [builtin, ...preserved];
  const found = modules.find((item) => item.hash === hash);
  if (found === undefined) return { found: false, reason: "missing" };
  return { found: true, module: found };
}
