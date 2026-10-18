// `packages.builtin`. 설치 사본(`<data root>/sdk`)의 내장 SDK(@lophn/*)를 읽어 목록과 안내를 돌려준다.
// 내장 SDK는 catalog가 아니라 설치 사본이 정본이다(catalog에 등록하지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BuiltinPackage } from "../../../protocol/apps/package-routes.ts";
import type { MemoryHandler } from "../../server/mod.ts";

const GUIDE_MAX_BYTES = 256 * 1024;

type Guide = { text: string; truncated: boolean };

function versionOrder(a: string, b: string): number {
  const left = a.split(/[.+-]/).map(Number);
  const right = b.split(/[.+-]/).map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readDirNames(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory) names.push(entry.name);
    }
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
  return names;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return null;
    throw cause;
  }
}

// guide.md가 있으면 그것이다. 없고 components/<분류>/mod.ts가 있으면(@lophn/ui) 분류마다 mod.ts 원문을 잇는다:
// "언제 쓰나" 한 줄이 그 주석에 있어서 따로 쓰면 낡는다. 둘 다 없으면 null이다.
async function guideOf(folder: string): Promise<string | null> {
  const written = await readTextOrNull(`${folder}/guide.md`);
  if (written !== null) return written;
  const sections: string[] = [];
  for (const category of (await readDirNames(`${folder}/components`)).sort()) {
    if (category.startsWith("_")) continue;
    const mod = await readTextOrNull(
      `${folder}/components/${category}/mod.ts`,
    );
    if (mod !== null) sections.push(`## ${category}\n\n${mod}`);
  }
  return sections.length === 0 ? null : sections.join("\n\n");
}

function limited(text: string): Guide {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= GUIDE_MAX_BYTES) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, GUIDE_MAX_BYTES));
  // 잘린 멀티바이트가 교체 문자로 끝에 남으면 버린다.
  return { text: cut.replace(/�$/, ""), truncated: true };
}

export function readBuiltinSdk(deps: { dataRoot: string }): MemoryHandler {
  const sdkRoot = `${deps.dataRoot}/sdk`;
  return async (_ctx, raw): Promise<Result<unknown>> => {
    const { name } = raw as { name?: string };
    try {
      const found: { entry: BuiltinPackage; text: string | null }[] = [];
      for (const part of await readDirNames(sdkRoot)) {
        if (part.startsWith("@")) continue;
        if (name !== undefined && name !== `@lophn/${part}`) continue;
        const newest = (await readDirNames(`${sdkRoot}/${part}`))
          .sort(versionOrder).at(-1);
        if (newest === undefined) continue;
        const text = await guideOf(`${sdkRoot}/${part}/${newest}`);
        found.push({
          entry: {
            name: `@lophn/${part}`,
            version: newest,
            has_guide: text !== null,
          },
          text,
        });
      }
      found.sort((a, b) => a.entry.name < b.entry.name ? -1 : 1);
      if (name === undefined) {
        return ok({ packages: found.map((one) => one.entry), guide: null });
      }
      const one = found[0];
      if (one === undefined) {
        return err({ code: "not_found", message: `${name} is not installed` });
      }
      return ok({
        packages: [one.entry],
        guide: one.text === null ? null : limited(one.text),
      });
    } catch {
      return err({
        code: "unavailable",
        message: "the installed SDK could not be read",
      });
    }
  };
}
