// package 설치 사본.
// packages/sdk/*와 지원 소스(@lophn/ui·@lophn/wording)를 패키지마다 자기 완결 byte로 묶고,
// 설치 위치(`packageInstallPath`)의 파일 0444·디렉터리 0555로 풀어 놓는다.
// catalog 등록은 하지 않는다(같은 name·version의 byte가 바뀌면 등록이 conflict라 개발 중 기동이 막힌다).
// 사용자 package(@me)는 publish.ts가 낸다.

import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  packageNameSchema,
  type PackageRegisterVersionInput,
} from "../../../protocol/apps/mod.ts";
import {
  keepSourceFile,
  type SourceFile,
  SUPPORT_SOURCES,
  vendorFiles,
} from "./vendor.ts";

// blob 준비 통로. 검사한 byte를 그대로 넣는다.
export type PrepareBlob = (input: {
  principal: string;
  purpose: string;
  bytes: ReadableStream<Uint8Array>;
}) => Promise<
  Result<{ hash: string; size_bytes: number; preparation?: string }>
>;

// 설치와 publish가 blob을 준비하고 register_version을 부를 때 쓰는 machine이다.
export const INSTALL_PRINCIPAL = "machine:install";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 폴더의 파일을 상대 경로와 함께 모은다. keep은 파일과 폴더(끝에 `/`) 경로를 거른다.
async function collectSourceFiles(
  root: string,
  keep: (path: string) => boolean,
): Promise<Result<SourceFile[]>> {
  const files: SourceFile[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (keep(`${path}/`)) await visit(`${directory}/${entry.name}`, path);
      } else if (entry.isFile && keep(path)) {
        files.push({
          path,
          bytes: await Deno.readFile(`${directory}/${entry.name}`),
        });
      }
    }
  }
  try {
    await visit(root, "");
  } catch {
    return invalid(`package source is unreadable: ${root}`);
  }
  return files.length === 0
    ? invalid(`package source is empty: ${root}`)
    : ok(sortFiles(files));
}

function sortFiles(files: SourceFile[]): SourceFile[] {
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// manifest + 파일 내용을 순서대로 이은 자기 완결 byte다. hash는 이 byte의 sha256이다.
export function bundleBytes(
  files: readonly { path: string; bytes: Uint8Array }[],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const file of files) {
    chunks.push(encoder.encode(`${file.path}\n${file.bytes.length}\n`));
    chunks.push(file.bytes);
    chunks.push(encoder.encode("\n"));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// 설치 사본 이름 경계. `..`·절대·빈 구간은 거절이다.
function safeNamePart(name: string): string | undefined {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined;
  return name;
}

function splitPackageName(
  name: string,
): Result<{ scope: string; part: string }> {
  const parsed = packageNameSchema.safeParse(name);
  if (!parsed.success) return invalid("package name is not a catalog name");
  const slash = name.indexOf("/");
  const scope = name.slice(1, slash);
  const part = safeNamePart(name.slice(slash + 1));
  if (part === undefined) return invalid("package name part is not a path");
  return ok({ scope, part });
}

// 설치 사본의 위치. dataRoot와 bundle 안에서 같은 상대 경로다.
// @lophn은 `sdk/<part>/<version>`, @me는 `sdk/@me/<part>/<version>`이다(scope가 다른 같은 part가 부딪치지 않는다).
export function packageInstallPath(
  name: string,
  version: string,
): Result<string> {
  const split = splitPackageName(name);
  if (!split.ok) return split;
  return split.value.scope === "me"
    ? ok(`sdk/@me/${split.value.part}/${version}`)
    : ok(`sdk/${split.value.part}/${version}`);
}

// bundle과 안내 byte를 blob으로 준비한다. 준비한 byte의 hash만 ledger에 간다.
export async function prepareBundleBlobs(
  bundle: Uint8Array,
  guide: Uint8Array,
  principal: string,
  prepareBlob: PrepareBlob,
): Promise<
  Result<{
    bundleHash: string;
    guideHash: string;
    guideBlob: PackageRegisterVersionInput["guide_blob"];
  }>
> {
  const bundleHash = await sha256Hex(bundle);
  const guideHash = await sha256Hex(guide);
  const stream = (bytes: Uint8Array) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  const bundlePrepared = await prepareBlob({
    principal,
    purpose: "sdk_bundle",
    bytes: stream(bundle),
  });
  if (!bundlePrepared.ok) return bundlePrepared;
  if (bundlePrepared.value.hash !== bundleHash) {
    return invalid("bundle hash changed during preparation");
  }
  const guidePrepared = await prepareBlob({
    principal,
    purpose: "sdk_guide",
    bytes: stream(guide),
  });
  if (!guidePrepared.ok) return guidePrepared;
  if (guidePrepared.value.hash !== guideHash) {
    return invalid("guide hash changed during preparation");
  }
  // 준비 참조를 받으면 안내 blob을 register_version이 같은 transaction에서 등록한다.
  const guideBlob = guidePrepared.value.preparation === undefined
    ? undefined
    : {
      preparation: guidePrepared.value.preparation,
      principal,
      purpose: "sdk_guide",
      hash: guidePrepared.value.hash,
      size_bytes: guidePrepared.value.size_bytes,
    };
  return ok({ bundleHash, guideHash, guideBlob });
}

export async function removeInstallCopy(target: string): Promise<void> {
  // 읽기 전용 사본은 디렉터리 쓰기 권한을 먼저 돌려줘야 지울 수 있다.
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(target);
    await Deno.remove(target, { recursive: true });
  } catch {
    // 없는 사본이다.
  }
}

async function copiedPaths(
  directory: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      found.push(...await copiedPaths(`${directory}/${entry.name}`, path));
    } else found.push(path);
  }
  return found;
}

// 사본이 있고 파일 목록과 byte가 모두 같은지 본다.
export async function sameInstallCopy(
  target: string,
  files: readonly SourceFile[],
): Promise<boolean> {
  try {
    const found = await copiedPaths(target, "");
    if (found.length !== files.length) return false;
    for (const file of files) {
      const bytes = await Deno.readFile(`${target}/${file.path}`);
      if (
        bytes.length !== file.bytes.length ||
        bytes.some((byte, index) => byte !== file.bytes[index])
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function writeInstallCopy(
  target: string,
  files: readonly { path: string; bytes: Uint8Array }[],
): Promise<Result<void>> {
  let directories: string[];
  try {
    // 만들기는 쓸 수 있는 권한으로 하고, 파일을 다 쓴 뒤 디렉터리를 0555로 좁힌다.
    await Deno.mkdir(target, { recursive: true, mode: 0o755 });
    directories = [target];
    for (const file of files) {
      // 깊은 파일의 중간 폴더도 모두 0555로 좁힌다.
      const segments = file.path.split("/").slice(0, -1);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const directory = `${target}/${segments.slice(0, depth).join("/")}`;
        await Deno.mkdir(directory, { recursive: true, mode: 0o755 });
        directories.push(directory);
      }
      await Deno.writeFile(`${target}/${file.path}`, file.bytes, {
        mode: 0o444,
      });
    }
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `설치 사본을 쓰지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  // 사본 디렉터리는 모두 0555다. 깊은 곳부터 좁힌다.
  for (const directory of [...directories].reverse()) {
    try {
      await Deno.chmod(directory, 0o555);
    } catch {
      // 이미 0555면 없어도 된다.
    }
  }
  return ok(undefined);
}

// 같은 byte의 사본이 이미 있으면 그대로 두고, 다르면 지우고 다시 쓴다(사본은 0555라 덮어쓸 수 없다).
async function installCopy(
  dataRoot: string,
  name: string,
  version: string,
  files: readonly SourceFile[],
): Promise<Result<{ name: string; version: string; install_path: string }>> {
  const path = packageInstallPath(name, version);
  if (!path.ok) return path;
  const target = `${dataRoot}/${path.value}`;
  if (!await sameInstallCopy(target, files)) {
    await removeInstallCopy(target);
    const written = await writeInstallCopy(target, files);
    if (!written.ok) return written;
  }
  return ok({ name, version, install_path: target });
}

// 소스 폴더의 deno.json에서 이름과 판을 읽는다.
async function readIdentity(
  dir: string,
): Promise<Result<{ name: string; version: string }>> {
  try {
    const json = JSON.parse(await Deno.readTextFile(`${dir}/deno.json`));
    if (typeof json.name === "string" && typeof json.version === "string") {
      return ok({ name: json.name, version: json.version });
    }
  } catch {
    // 아래에서 invalid_input이다.
  }
  return invalid(`deno.json needs name and version: ${dir}`);
}

// 소스 폴더를 (규칙이 있으면 vendor/를 더해) 설치 사본으로 푼다.
async function installSource(
  dataRoot: string,
  packagesRoot: string,
  source: string,
  skip: readonly string[],
) {
  const dir = `${packagesRoot}/${source}`;
  const identity = await readIdentity(dir);
  if (!identity.ok) return identity;
  const collected = await collectSourceFiles(
    dir,
    (path) => keepSourceFile(path, skip),
  );
  if (!collected.ok) return collected;
  const vendored = await vendorFiles(
    identity.value.name,
    collected.value,
    packagesRoot,
  );
  if (!vendored.ok) return vendored;
  return await installCopy(
    dataRoot,
    identity.value.name,
    identity.value.version,
    sortFiles(vendored.value),
  );
}

// packages/sdk/* 중 deno.json이 있는 폴더 전부와 지원 소스를 `<dataRoot>/sdk/…`에 푼다.
// 하나라도 실패하면 그 err를 돌려주고 다음을 깔지 않는다.
export async function installSdkCopies(deps: {
  dataRoot: string;
  packagesRoot: string;
}): Promise<
  Result<{ name: string; version: string; install_path: string }[]>
> {
  const sources: { source: string; skip: readonly string[] }[] = [];
  try {
    const names: string[] = [];
    for await (const entry of Deno.readDir(`${deps.packagesRoot}/sdk`)) {
      if (entry.isDirectory) names.push(entry.name);
    }
    for (const name of names.sort()) {
      const source = `sdk/${name}`;
      try {
        await Deno.stat(`${deps.packagesRoot}/${source}/deno.json`);
        sources.push({ source, skip: [] });
      } catch {
        // deno.json이 없는 폴더는 판이 없어 깔지 않는다.
      }
    }
  } catch {
    return invalid(`sdk source is unreadable: ${deps.packagesRoot}/sdk`);
  }
  sources.push(...SUPPORT_SOURCES);
  const installed = [];
  for (const { source, skip } of sources) {
    const result = await installSource(
      deps.dataRoot,
      deps.packagesRoot,
      source,
      skip,
    );
    if (!result.ok) return result;
    installed.push(result.value);
  }
  return ok(installed);
}
