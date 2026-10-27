import { err, ok, type Result } from "../../../base/mod.ts";
import type { AppScreenFileInput } from "../../../protocol/apps/calls/mod.ts";
import { relativePathSchema } from "../../../protocol/projects/values.ts";
import type { BundleLocator } from "../ports.ts";
import { screenContentType } from "./content-type.ts";

const DEFAULT_MAX_SCREEN_FILE_BYTES = 8 * 1024 * 1024;

export type ScreenFileDeps = {
  bundles: BundleLocator;
  /** 파일 하나의 byte. 없음, 폴더, `maxBytes` 초과는 모두 null이다. */
  readFile(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** symlink를 푼 실제 경로. 없으면 null이다. */
  realPath(path: string): Promise<string | null>;
  maxBytes?: number;
};

type ScreenFile = { bytes: Uint8Array; contentType: string };

const notFound = () =>
  err({ code: "not_found" as const, message: "screen file not found" });

function badScreen(screen: string): boolean {
  return (
    screen.trim() === "" ||
    screen === "." ||
    screen === ".." ||
    screen.includes("/") ||
    screen.includes("\\")
  );
}

function badPath(path: string): boolean {
  return !relativePathSchema.safeParse(path).success || path.includes(":");
}

// bundle 사본의 `screens/<screen>/<path>` 파일 하나를 읽어 준다. 쓰기는 하지 않는다.
// 그 screen 폴더 밖(다른 screen, bundle 밖, 밖을 가리키는 symlink), 폴더, 너무 큰 파일은
// 없는 파일과 같은 not_found다.
export async function serveScreenFile(
  deps: ScreenFileDeps,
  input: AppScreenFileInput,
): Promise<Result<ScreenFile>> {
  const { screen, path } = input;
  if (badScreen(screen)) {
    return err({ code: "invalid_input", message: "invalid screen" });
  }
  if (badPath(path)) {
    return err({ code: "invalid_input", message: "invalid screen file path" });
  }

  const bundle = deps.bundles.dir(input.target);
  if (!bundle.ok) return bundle;

  const root = bundle.value.replace(/\/+$/, "");
  const screenRoot = await deps.realPath(`${root}/screens/${screen}`);
  if (screenRoot === null) return notFound();
  const file = await deps.realPath(`${screenRoot}/${path}`);
  if (file === null || !file.startsWith(`${screenRoot}/`)) return notFound();

  const bytes = await deps.readFile(
    file,
    deps.maxBytes ?? DEFAULT_MAX_SCREEN_FILE_BYTES,
  );
  if (bytes === null) return notFound();
  return ok({ bytes, contentType: screenContentType(path) });
}
