// 앱(또는 release staging) 폴더의 `package.json`이 `file:.lophn/sdk/...`로 거는 SDK 사본을 설치 위치
// (`<dataRoot>/sdk/...`)에서 그 폴더의 `.lophn/sdk/...`로 복사한다. npm install보다 먼저 부른다.
// 사본이 링크가 아니라 실제 file인 이유: Node는 `node_modules` 안의 `.ts`를 돌리지 않으므로 npm이 거는
// `node_modules/@lophn/*` symlink의 실제 경로가 `node_modules` 밖이어야 하고, SDK가 쓰는 npm 의존은 그
// 실제 경로에서 위로 올라가 앱의 `node_modules`에서 풀려야 한다.
// SDK 사본끼리의 의존도 `file:../../<이름>/<판>`이라 같은 방법으로 따라가 복사한다.
import { chmod, cp, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import { err, errorCode, ok, type Result } from "../../../base/mod.ts";

export const APP_SDK_FOLDER = ".lophn/sdk";
const FILE_PREFIX = "file:";

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function readManifest(dir: string): Promise<Result<Manifest>> {
  try {
    return ok(JSON.parse(await readFile(join(dir, "package.json"), "utf8")));
  } catch (thrown) {
    return errorCode(thrown) === "ENOENT"
      ? err({ code: "not_found", message: `package.json is missing: ${dir}` })
      : err({
          code: "invalid_input",
          message: `package.json is invalid: ${dir}`,
        });
  }
}

// `file:` 값이 가리키는 `.lophn/sdk` 안 상대 경로(`sdk/<이름>/<판>`). 밖을 가리키면 undefined다.
function sdkPath(
  appDir: string,
  from: string,
  value: string,
): string | undefined {
  if (!value.startsWith(FILE_PREFIX)) return undefined;
  const target = normalize(join(from, value.slice(FILE_PREFIX.length)));
  // package.json 안과 `sdk/...` 목록은 `/` 꼴이다. Windows의 relative는 `\`로 잇는다.
  const inside = relative(join(appDir, ".lophn"), target).split(sep).join("/");
  return inside.startsWith("sdk/") && !inside.split("/").includes("..")
    ? inside
    : undefined;
}

// 설치 사본은 파일 0444·폴더 0555다. 폴더의 쓰기 권한을 돌려주지 않으면 이전 사본을 지울 수 없다.
async function removeCopy(target: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(target);
    await rm(target, { recursive: true });
  } catch {
    // 아직 사본이 없다.
  }
}

// 앱 agent가 읽는 이유다. 앱이 건 판과 설치된 판을 보여 줘 의존을 설치된 판으로 올리게 한다.
async function notInstalledMessage(
  dataRoot: string,
  path: string,
): Promise<string> {
  const folder = dirname(path);
  const name = folder.startsWith("sdk/@me/")
    ? `@me/${folder.slice("sdk/@me/".length)}`
    : `@lophn/${folder.slice("sdk/".length)}`;
  const pinned = path.slice(folder.length + 1);
  const installed = await readdir(join(dataRoot, folder)).catch(() => []);
  const have =
    installed.length > 0 ? installed.join(", ") : "none (not installed)";
  return `SDK is not installed: ${name}@${pinned} (${path}). Installed versions: ${have}. Update the app's ${name} dependency in package.json to an installed version; the newer SDK may need code changes.`;
}

// 복사한 `sdk/...` 경로 목록을 돌려준다. 설치되지 않은 판은 not_found다.
export async function syncAppSdk(
  appDir: string,
  dataRoot: string,
): Promise<Result<string[]>> {
  const done = new Set<string>();
  const pending: { from: string; manifest: Manifest }[] = [];
  const root = await readManifest(appDir);
  if (!root.ok) return root;
  pending.push({ from: appDir, manifest: root.value });
  while (pending.length > 0) {
    const { from, manifest } = pending.pop()!;
    const values = Object.values({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    for (const value of values) {
      const path = sdkPath(appDir, from, value);
      if (path === undefined || done.has(path)) continue;
      done.add(path);
      const source = join(dataRoot, path);
      const target = join(appDir, ".lophn", path);
      try {
        await stat(join(source, "package.json"));
      } catch {
        return err({
          code: "not_found",
          message: await notInstalledMessage(dataRoot, path),
        });
      }
      try {
        await removeCopy(target);
        await cp(source, target, { recursive: true });
      } catch {
        return err({
          code: "unavailable",
          message: `SDK copy could not be made: ${path}`,
        });
      }
      const copied = await readManifest(target);
      if (!copied.ok) return copied;
      pending.push({ from: target, manifest: copied.value });
    }
  }
  return ok([...done].sort());
}

// 앱 package.json에 쓰는 SDK 의존 값. `installPath`는 `packageInstallPath`의 값(`sdk/...`)이다.
export function appSdkDependency(installPath: string): string {
  return `${FILE_PREFIX}.lophn/${installPath}`;
}

// 사본이 SDK 사본끼리 거는 의존 값. 두 설치 경로 사이의 상대 경로다.
export function sdkCopyDependency(from: string, to: string): string {
  return `${FILE_PREFIX}${relative(from, to).split(sep).join("/") || "."}`;
}
