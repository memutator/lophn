import { Buffer } from "node:buffer";
import { sep } from "node:path";
import { ok, type Result } from "../../../base/mod.ts";
import type { AppIcon } from "../../../protocol/apps/declaration/read.ts";
import type { BundleLocator } from "../ports.ts";
import { screenContentType } from "./content-type.ts";

const MAX_ICON_BYTES = 64 * 1024;
const ICON_TYPES = ["image/svg+xml", "image/png", "image/webp"];

export type AppIconDeps = {
  bundles: BundleLocator;
  /** active release 선언의 icon 경로(`/assets/icon.svg`). 선언에 없으면 null. */
  iconPath(app: string): Result<string | null>;
  readFile(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** symlink를 푼 실제 경로. 없으면 null이다. */
  realPath(path: string): Promise<string | null>;
};

// bundle 사본의 icon 파일 하나를 base64로 준다. 앱 모양일 뿐이라 못 읽는 이유(선언 없음, 파일 없음, 큼,
// bundle 밖을 가리키는 symlink)는 모두 null이고 오류로 올리지 않는다.
export async function readAppIcon(
  deps: AppIconDeps,
  app: string,
): Promise<Result<AppIcon | null>> {
  const declared = deps.iconPath(app);
  if (!declared.ok) return declared;
  if (declared.value === null) return ok(null);
  const contentType = screenContentType(declared.value);
  if (!ICON_TYPES.includes(contentType)) return ok(null);

  const bundle = deps.bundles.dir({
    mode: "live",
    app: app as never,
    release: null,
  });
  if (!bundle.ok) return ok(null);
  const root = await deps.realPath(bundle.value);
  if (root === null) return ok(null);
  const file = await deps.realPath(`${root}${declared.value}`);
  // realpath는 OS 구분자로 잇는다(Windows는 `\`).
  if (file === null || !file.startsWith(`${root}${sep}`)) return ok(null);
  const bytes = await deps.readFile(file, MAX_ICON_BYTES);
  if (bytes === null || bytes.byteLength === 0) return ok(null);
  return ok({
    content_type: contentType as AppIcon["content_type"],
    data: Buffer.from(bytes).toString("base64"),
  });
}
