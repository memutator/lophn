// 읽기 전용 bundle 사본과 seal(apps/releases#R1, architecture/apps 3.2).
// 사본은 `apps/<app ID>/bundles/<bundle hash>/`의 파일 0444·디렉터리 0555다.
// 그 안의 정규 `blueprint.json`과 source map 자리는 problems test runner가 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BundleManifest } from "../../../protocol/apps/mod.ts";
import {
  appIdSchema,
  relativePathSchema,
} from "../../../protocol/projects/mod.ts";
import { sha256Schema } from "../../../protocol/platform/mod.ts";

export type SealFailure = {
  code: "unavailable" | "invalid_input";
  message: string;
};

const FILE_MODE = 0o444;
const DIRECTORY_MODE = 0o555;

// bundle 사본 위치 규칙(apps/plan apps#T6). contracts#T36 경로 함수가 없으므로
// 이 leaf가 계산한다. app ID와 hash를 검사하지 않으면 data root 밖으로 나간다.
export function bundleCopyPath(
  dataRoot: string,
  app: string,
  bundleHash: string,
): Result<string, SealFailure> {
  if (!appIdSchema.safeParse(app).success) {
    return err({ code: "invalid_input", message: "app id is not an app id" });
  }
  if (!sha256Schema.safeParse(bundleHash).success) {
    return err({
      code: "invalid_input",
      message: "bundle hash is not a sha256",
    });
  }
  return ok(`${dataRoot}/apps/${app}/bundles/${bundleHash}`);
}

// 정규 blueprint.json과 source map 자리. bundle 사본 안의 고정 이름이다.
export const BLUEPRINT_COPY_NAME = "blueprint.json";
export const SOURCE_MAP_COPY_NAME = "app.js.map";
export const MANIFEST_COPY_NAME = "manifest.json";

function relativeCopyPath(path: string): Result<string, SealFailure> {
  if (!relativePathSchema.safeParse(path).success) {
    return err({
      code: "invalid_input",
      message: "bundle path escapes the copy",
    });
  }
  return ok(path);
}

async function chmodOrFail(
  path: string,
  mode: number,
): Promise<Result<void, SealFailure>> {
  try {
    await Deno.chmod(path, mode);
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `bundle 사본 권한을 좁히지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  return ok(undefined);
}

// bundle byte·manifest·정규 blueprint JSON·source map을 봉인한다.
// 파일은 0444, 디렉터리는 0555로 좁힌다. umask와 상관없이 chmod를 다시 한다.
export async function sealBundle(
  input: {
    copyPath: string;
    manifest: BundleManifest;
    blueprintJson: Uint8Array;
    bundleFiles: readonly { path: string; bytes: Uint8Array }[];
    sourceMap?: { path: string; bytes: Uint8Array };
  },
): Promise<Result<void, SealFailure>> {
  const directories: string[] = [input.copyPath];
  const files: string[] = [];
  try {
    await Deno.mkdir(input.copyPath, { recursive: true });
    const written: { path: string; bytes: Uint8Array }[] = [];
    const seen = new Set<string>();
    const push = (path: string, bytes: Uint8Array): void => {
      if (seen.has(path)) return;
      seen.add(path);
      written.push({ path, bytes });
    };
    for (const file of input.bundleFiles) push(file.path, file.bytes);
    push(BLUEPRINT_COPY_NAME, input.blueprintJson);
    push(
      MANIFEST_COPY_NAME,
      new TextEncoder().encode(JSON.stringify(input.manifest)),
    );
    if (input.sourceMap) {
      push(input.sourceMap.path || SOURCE_MAP_COPY_NAME, input.sourceMap.bytes);
    }
    for (const file of written) {
      const relative = relativeCopyPath(file.path);
      if (!relative.ok) return relative;
      // 깊은 파일의 중간 폴더도 모두 좁힌다. 파일 바로 위 폴더만 좁히면 중간 폴더에 쓸 수 있다(R1).
      const segments = relative.value.split("/").slice(0, -1);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const directory = `${input.copyPath}/${
          segments.slice(0, depth).join("/")
        }`;
        await Deno.mkdir(directory, { recursive: true });
        directories.push(directory);
      }
      const target = `${input.copyPath}/${relative.value}`;
      await Deno.writeFile(target, file.bytes);
      const narrowedFile = await chmodOrFail(target, FILE_MODE);
      if (!narrowedFile.ok) return narrowedFile;
      files.push(target);
    }
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `bundle 사본을 쓰지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  for (const directory of [...new Set(directories)].reverse()) {
    const narrowed = await chmodOrFail(directory, DIRECTORY_MODE);
    if (!narrowed.ok) return narrowed;
  }
  for (const file of files) {
    const narrowed = await chmodOrFail(file, FILE_MODE);
    if (!narrowed.ok) return narrowed;
  }
  return ok(undefined);
}

async function walk(
  directory: string,
  visit: (
    path: string,
    info: Deno.FileInfo,
  ) => Promise<Result<void, SealFailure>>,
): Promise<Result<void, SealFailure>> {
  const info = await Deno.stat(directory);
  const self = await visit(directory, info);
  if (!self.ok) return self;
  if (!info.isDirectory) return ok(undefined);
  for await (const entry of Deno.readDir(directory)) {
    const walked = await walk(`${directory}/${entry.name}`, visit);
    if (!walked.ok) return walked;
  }
  return ok(undefined);
}

// 사본이 정말 0444·0555인지 재귀로 본다(R1).
export async function verifySealedPermissions(
  copyPath: string,
): Promise<Result<void, SealFailure>> {
  try {
    return await walk(copyPath, (_path, info) => {
      const writable = ((info.mode ?? 0) & 0o222) !== 0;
      if (writable) {
        return Promise.resolve(
          err({
            code: "invalid_input",
            message: info.isDirectory
              ? "bundle copy directory is writable"
              : "bundle copy file is writable",
          }),
        );
      }
      return Promise.resolve(ok(undefined));
    });
  } catch {
    return err({ code: "invalid_input", message: "bundle copy is missing" });
  }
}
