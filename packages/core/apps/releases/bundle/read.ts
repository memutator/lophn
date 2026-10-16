// 봉인 bundle 사본에서 release의 source 파일과 source map을 읽는다. 사본은 읽기만 한다.
// coding session의 source diff(ReleaseSourceReader)와 annotation의 source 위치(ReleaseSourceMaps)가 쓴다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { readBundleCopy } from "../activation/desired.ts";
import { loadRelease } from "../store.ts";
import { RUNTIME_CONFIG_PATH, RUNTIME_ENTRY_PATH } from "./runtime-entry.ts";
import { SOURCE_MAP_COPY_NAME } from "./seal.ts";

// 앱 source가 아닌 파일이다(준비가 만들거나 담은 것).
const GENERATED_FILES = new Set([
  "blueprint.json",
  "manifest.json",
  "import-map.json",
  RUNTIME_ENTRY_PATH,
  RUNTIME_CONFIG_PATH,
  SOURCE_MAP_COPY_NAME,
]);
const GENERATED_FOLDERS = ["screens/", "sdk/", "vendor/", "node_modules/"];

// 이보다 크면 내용을 싣지 않는다(patch를 만들지 못한다).
const MAX_TEXT_BYTES = 256 * 1024;

type ReleaseBundleSource =
  | { preserved: true; files: ReadonlyMap<string, string | null> }
  | { preserved: false; reason: string };

type Deps = { ledgerPath: string; dataRoot: string };

// 앱의 release가 아니면 not_found다.
function bundleOf(
  deps: Deps,
  app: string,
  release: string,
): Result<string> {
  const opened = openConnection(deps.ledgerPath);
  if (!opened.ok) {
    return err({ code: "unavailable", message: "ledger is unavailable" });
  }
  try {
    const found = loadRelease(opened.value.sql, release);
    if (!found.ok) return found;
    if (found.value === null || found.value.app !== app) {
      return err({ code: "not_found", message: "release not found" });
    }
    return ok(found.value.bundle_hash);
  } finally {
    opened.value.close();
  }
}

export function createReleaseSourceReader(deps: Deps) {
  return {
    async read(
      app: string,
      release: string,
    ): Promise<Result<ReleaseBundleSource>> {
      const hash = bundleOf(deps, app, release);
      if (!hash.ok) return hash;
      const copy = await readBundleCopy(deps.dataRoot, app, hash.value);
      if (!copy.ok) {
        return ok({ preserved: false, reason: "bundle unreadable" });
      }
      if (copy.value === undefined) {
        return ok({ preserved: false, reason: "bundle copy is gone" });
      }
      const files = new Map<string, string | null>();
      for (const file of copy.value.manifest.files) {
        if (
          GENERATED_FILES.has(file.path) ||
          GENERATED_FOLDERS.some((folder) => file.path.startsWith(folder))
        ) continue;
        try {
          const bytes = await Deno.readFile(`${copy.value.root}/${file.path}`);
          files.set(
            file.path,
            bytes.byteLength > MAX_TEXT_BYTES ? null : decodeText(bytes),
          );
        } catch {
          return ok({ preserved: false, reason: "bundle file unreadable" });
        }
      }
      return ok({ preserved: true, files });
    },
  };
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// release의 UI bundle 파일에 맞는 source map 본문이다. 없으면 null이다.
export function createReleaseSourceMaps(deps: Deps) {
  return {
    async sourceMap(
      app: string,
      release: string,
      bundleFile: string,
    ): Promise<Result<string | null>> {
      const hash = bundleOf(deps, app, release);
      if (!hash.ok) return hash.error.code === "not_found" ? ok(null) : hash;
      const copy = await readBundleCopy(deps.dataRoot, app, hash.value);
      if (!copy.ok) return copy;
      if (
        copy.value === undefined ||
        !copy.value.manifest.files.some((file) => file.path === bundleFile)
      ) return ok(null);
      try {
        return ok(
          await Deno.readTextFile(`${copy.value.root}/${SOURCE_MAP_COPY_NAME}`),
        );
      } catch {
        return ok(null);
      }
    },
  };
}
