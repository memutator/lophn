// 읽기 전용 bundle 사본과 seal.
// 사본은 `apps/<app ID>/bundles/<bundle hash>/`의 파일 0444·디렉터리 0555다.
// 그 안의 정규 `declaration.json`은 release 준비가 읽어 `release.record`에 싣는다(control.ts).
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  appBundleCopy,
  type BundleManifest,
} from "../../../../protocol/apps/mod.ts";
import {
  appIdSchema,
  relativePathSchema,
} from "../../../../protocol/projects/mod.ts";
import { sha256Schema } from "../../../../protocol/base/mod.ts";
import { createLinks, decodeLinks, LINKS_PATH } from "./links.ts";

type SealFailure = {
  code: "unavailable" | "invalid_input";
  message: string;
};

const FILE_MODE = 0o444;
const DIRECTORY_MODE = 0o555;

// bundle 사본 위치. 경로 규칙은 protocol의 appBundleCopy가 갖고, 여기서는 app id와 hash 모양을 Result로 검사한다.
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
  return ok(appBundleCopy(dataRoot, app, bundleHash));
}

// 정규 declaration.json 자리. bundle 사본 안의 고정 이름이다.
export const DECLARATION_COPY_NAME = "declaration.json";
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
    await chmod(path, mode);
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

// bundle byte·manifest·정규 선언 JSON을 사본에 쓴다. 파일은 0444로 좁히지만 폴더는 열어 둔다.
// 연결(symlink)은 만들지 않는다: 준비 자식의 좁힌 권한으로는 만들 수 없어, 권한이 있는 core가 `sealCopy`로 마친다.
export async function writeBundle(input: {
  copyPath: string;
  manifest: BundleManifest;
  declarationJson: Uint8Array;
  bundleFiles: readonly { path: string; bytes: Uint8Array }[];
}): Promise<Result<void, SealFailure>> {
  // 사본 폴더를 만들기 전에 거른다. 사본 밖을 가리키는 연결은 아무것도 만들지 않고 거절한다.
  const linksFile = input.bundleFiles.find((file) => file.path === LINKS_PATH);
  const links = linksFile ? decodeLinks(linksFile.bytes) : ok([]);
  if (!links.ok) return links;
  const linkPaths = new Set(links.value.map((link) => link.path));
  if (input.bundleFiles.some((file) => linkPaths.has(file.path))) {
    return err({
      code: "invalid_input",
      message: "bundle link path is also a file",
    });
  }
  try {
    await mkdir(input.copyPath, { recursive: true });
    const written: { path: string; bytes: Uint8Array }[] = [];
    const seen = new Set<string>();
    const push = (path: string, bytes: Uint8Array): void => {
      if (seen.has(path)) return;
      seen.add(path);
      written.push({ path, bytes });
    };
    for (const file of input.bundleFiles) push(file.path, file.bytes);
    push(DECLARATION_COPY_NAME, input.declarationJson);
    push(
      MANIFEST_COPY_NAME,
      new TextEncoder().encode(JSON.stringify(input.manifest)),
    );
    for (const file of written) {
      const relative = relativeCopyPath(file.path);
      if (!relative.ok) return relative;
      const target = `${input.copyPath}/${relative.value}`;
      await mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(target, file.bytes);
      const narrowedFile = await chmodOrFail(target, FILE_MODE);
      if (!narrowedFile.ok) return narrowedFile;
    }
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `bundle 사본을 쓰지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  return ok(undefined);
}

// 쓴 사본을 봉인한다: 연결 목록 file대로 symlink를 만들고, 폴더는 0555·file은 0444로 좁힌다. 이미 봉인된
// 사본(맨 위 폴더에 쓰기 비트가 없다)은 그대로 둔다. 연결은 읽을 때 한 번 더 사본 안으로 걸러진다.
export async function sealCopy(
  copyPath: string,
): Promise<Result<void, SealFailure>> {
  try {
    const top = await stat(copyPath);
    if (((top.mode ?? 0) & 0o222) === 0) return ok(undefined);
    const linksFile = await readFile(`${copyPath}/${LINKS_PATH}`).catch(
      () => undefined,
    );
    const links = linksFile ? decodeLinks(linksFile) : ok([]);
    if (!links.ok) return links;
    await createLinks(copyPath, links.value);
    // 연결을 따라가지 않는다. 폴더는 안쪽부터 좁힌다.
    const narrow = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) await narrow(path);
        else if (entry.isFile()) await chmod(path, FILE_MODE);
      }
      await chmod(directory, DIRECTORY_MODE);
    };
    await narrow(copyPath);
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `bundle 사본을 봉인하지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  return ok(undefined);
}

// 쓰기와 봉인을 한 번에 한다. 권한이 있는 곳(시험, 준비 자식이 아닌 process)이 쓴다.
export async function sealBundle(
  input: Parameters<typeof writeBundle>[0],
): Promise<Result<void, SealFailure>> {
  const written = await writeBundle(input);
  return written.ok ? await sealCopy(input.copyPath) : written;
}
