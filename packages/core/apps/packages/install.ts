// package 설치 사본.
// packages/sdk/*와 지원 소스(@lophn/ui·@lophn/i18n)를 패키지마다 자기 완결 byte로 묶고,
// 설치 위치(`packageInstallPath`)의 파일 0444·디렉터리 0555로 풀어 놓는다.
// catalog 등록은 하지 않는다(같은 name·version의 byte가 바뀌면 등록이 conflict라 개발 중 기동이 막힌다).
// 사용자 package(@me)는 publish.ts가 낸다.

import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  type PackageRegisterVersionInput,
  packageNameSchema,
  packageRegisterVersion,
  packageVersionNameSchema,
} from "../../../protocol/apps/mod.ts";
import {
  PACKAGE_BUNDLE_BLOB_PURPOSE,
  PACKAGE_GUIDE_BLOB_PURPOSE,
} from "./blobs.ts";
import { sdkCopyDependency } from "./sdk-sync.ts";
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
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (keep(`${path}/`)) await visit(`${directory}/${entry.name}`, path);
      } else if (entry.isFile() && keep(path)) {
        files.push({
          path,
          bytes: await readFile(`${directory}/${entry.name}`),
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

function safeBundlePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("\\") &&
      !segment.includes("\0"),
  );
}

// bundleBytes의 역이다. 모양이 어긋나면 invalid_input이다(hash가 맞아도 되살리기는 이 모양만 받는다).
export function bundleFiles(bytes: Uint8Array): Result<SourceFile[]> {
  const decoder = new TextDecoder();
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  let offset = 0;
  // 줄 하나(`\n` 앞까지)를 읽고 offset을 줄 뒤로 옮긴다.
  const line = (): string | undefined => {
    const end = bytes.indexOf(0x0a, offset);
    if (end < 0) return undefined;
    const text = decoder.decode(bytes.subarray(offset, end));
    offset = end + 1;
    return text;
  };
  while (offset < bytes.length) {
    const path = line();
    const length = line();
    if (path === undefined || length === undefined || !/^\d+$/.test(length)) {
      return invalid("bundle bytes are malformed");
    }
    if (!safeBundlePath(path) || seen.has(path)) {
      return invalid(`bundle file path is not valid: ${path}`);
    }
    seen.add(path);
    const size = Number(length);
    if (offset + size + 1 > bytes.length || bytes[offset + size] !== 0x0a) {
      return invalid("bundle bytes are malformed");
    }
    files.push({ path, bytes: bytes.slice(offset, offset + size) });
    offset += size + 1;
  }
  return files.length === 0 ? invalid("bundle bytes are empty") : ok(files);
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

// 사본의 package.json은 npm이 읽는다. 사본끼리의 의존은 두 설치 위치 사이의 `file:` 상대 경로로 바꾼다.
// 저장소에서는 npm workspace가 이름으로 풀지만, 사본은 앱 폴더 안에 있어 registry에 없는 @lophn·@me
// 이름을 그대로 두면 npm이 registry에서 받으려 한다. npm 의존은 정확한 판 그대로 둔다.
function rewriteDependencies(
  installPath: string,
  text: string,
  identity: { name: string; version: string },
): Result<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid("package.json is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalid("package.json is not an object");
  }
  const manifest = parsed as Record<string, unknown>;
  // 입력 name·version이 설치 경로와 catalog 값을 정하므로 폴더가 다른 package를 이 이름으로 내지 못하게 맞춘다.
  if (manifest["name"] !== identity.name) {
    return invalid(
      `package.json name does not match ${identity.name}: ${String(manifest["name"])}`,
    );
  }
  if (manifest["version"] !== identity.version) {
    return invalid(
      `package.json version does not match ${identity.version}: ${String(manifest["version"])}`,
    );
  }
  for (const field of ["dependencies", "devDependencies"] as const) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return invalid(`${field} is not an object`);
    }
    const dependencies = value as Record<string, unknown>;
    for (const [name, version] of Object.entries(dependencies)) {
      if (!name.startsWith("@lophn/") && !name.startsWith("@me/")) continue;
      if (
        typeof version !== "string" ||
        !packageVersionNameSchema.safeParse(version).success
      ) {
        return invalid(`${name} dependency needs one exact version`);
      }
      const dependencyPath = packageInstallPath(name, version);
      if (!dependencyPath.ok) return dependencyPath;
      dependencies[name] = sdkCopyDependency(installPath, dependencyPath.value);
    }
  }
  return ok(`${JSON.stringify(manifest, null, 2)}\n`);
}

// 사본으로 풀 file 목록이다. package.json이 있어야 npm이 사본을 package로 읽고, 그 안의 의존을 푼다.
export function prepareCopyFiles(
  name: string,
  version: string,
  files: readonly SourceFile[],
): Result<SourceFile[]> {
  const installPath = packageInstallPath(name, version);
  if (!installPath.ok) return installPath;
  const manifest = files.find((file) => file.path === "package.json");
  if (manifest === undefined) {
    return invalid(`package source has no package.json: ${name}@${version}`);
  }
  const text = rewriteDependencies(
    installPath.value,
    new TextDecoder().decode(manifest.bytes),
    { name, version },
  );
  if (!text.ok) return text;
  return ok(
    sortFiles(
      files.map((file) =>
        file === manifest
          ? { path: file.path, bytes: new TextEncoder().encode(text.value) }
          : file,
      ),
    ),
  );
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// 준비 참조를 받으면 register_version이 같은 transaction에서 등록한다. 참조 없는 준비는 등록할 수 없다.
type PreparedResult = {
  hash: string;
  size_bytes: number;
  preparation?: string;
};
function asPreparedBlob(
  principal: string,
  purpose: string,
  prepared: PreparedResult,
): PackageRegisterVersionInput["bundle_blob"] {
  return prepared.preparation === undefined
    ? undefined
    : {
        preparation: prepared.preparation,
        principal,
        purpose,
        hash: prepared.hash,
        size_bytes: prepared.size_bytes,
      };
}

// bundle byte를 blob으로 준비한다. 준비한 byte의 hash만 ledger에 간다.
export async function prepareBundleBlob(
  bundle: Uint8Array,
  principal: string,
  prepareBlob: PrepareBlob,
): Promise<
  Result<{
    bundleHash: string;
    bundleBlob: PackageRegisterVersionInput["bundle_blob"];
  }>
> {
  const bundleHash = await sha256Hex(bundle);
  const prepared = await prepareBlob({
    principal,
    purpose: PACKAGE_BUNDLE_BLOB_PURPOSE,
    bytes: byteStream(bundle),
  });
  if (!prepared.ok) return prepared;
  if (prepared.value.hash !== bundleHash) {
    return invalid("bundle hash changed during preparation");
  }
  return ok({
    bundleHash,
    bundleBlob: asPreparedBlob(
      principal,
      PACKAGE_BUNDLE_BLOB_PURPOSE,
      prepared.value,
    ),
  });
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
    bundleBlob: PackageRegisterVersionInput["bundle_blob"];
    guideBlob: PackageRegisterVersionInput["guide_blob"];
  }>
> {
  const bundlePrepared = await prepareBundleBlob(
    bundle,
    principal,
    prepareBlob,
  );
  if (!bundlePrepared.ok) return bundlePrepared;
  const guideHash = await sha256Hex(guide);
  const guidePrepared = await prepareBlob({
    principal,
    purpose: PACKAGE_GUIDE_BLOB_PURPOSE,
    bytes: byteStream(guide),
  });
  if (!guidePrepared.ok) return guidePrepared;
  if (guidePrepared.value.hash !== guideHash) {
    return invalid("guide hash changed during preparation");
  }
  return ok({
    ...bundlePrepared.value,
    guideHash,
    guideBlob: asPreparedBlob(
      principal,
      PACKAGE_GUIDE_BLOB_PURPOSE,
      guidePrepared.value,
    ),
  });
}

// package.register_version을 writer에 내는 envelope. publish와 부팅 때 bundle blob 붙이기가 같은 key를 쓴다.
// 옛 판(bundle blob 없이 등록)의 key와 겹치면 writer가 옛 결과를 그대로 돌려줘 blob이 안 붙으므로
// bundle blob을 가진 입력이라는 표시가 key에 들어 있다.
export async function registerVersionEnvelope(
  input: PackageRegisterVersionInput,
) {
  const key = `package-publish-${await sha256Hex(
    `${input.name}\n${input.version}\n${input.bundle_hash}\n${input.guide_hash}\nbundle-blob`,
  )}`;
  return {
    command: packageRegisterVersion.name,
    input,
    compare: {},
    idempotency_key: key,
    prepared: [input.guide_blob, input.bundle_blob]
      .filter((blob) => blob !== undefined)
      .map((blob) => blob.preparation),
  };
}

export async function removeInstallCopy(target: string): Promise<void> {
  // 읽기 전용 사본은 디렉터리 쓰기 권한을 먼저 돌려줘야 지울 수 있다.
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
    // 없는 사본이다.
  }
}

async function copiedPaths(
  directory: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await copiedPaths(`${directory}/${entry.name}`, path)));
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
    const matches = await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(`${target}/${file.path}`);
        return (
          bytes.length === file.bytes.length &&
          !bytes.some((byte, index) => byte !== file.bytes[index])
        );
      }),
    );
    return matches.every(Boolean);
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
    await mkdir(target, { recursive: true, mode: 0o755 });
    directories = [target];
    for (const file of files) {
      // 깊은 파일의 중간 폴더도 모두 0555로 좁힌다.
      const segments = file.path.split("/").slice(0, -1);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const directory = `${target}/${segments.slice(0, depth).join("/")}`;
        await mkdir(directory, { recursive: true, mode: 0o755 });
        directories.push(directory);
      }
      await writeFile(`${target}/${file.path}`, file.bytes, {
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
      await chmod(directory, 0o555);
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
  if (!(await sameInstallCopy(target, files))) {
    await removeInstallCopy(target);
    const written = await writeInstallCopy(target, files);
    if (!written.ok) return written;
  }
  return ok({ name, version, install_path: target });
}

// 소스 폴더의 package.json에서 이름과 판을 읽는다.
async function readIdentity(
  dir: string,
): Promise<Result<{ name: string; version: string }>> {
  try {
    const json = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
    if (typeof json.name === "string" && typeof json.version === "string") {
      return ok({ name: json.name, version: json.version });
    }
  } catch {
    // 아래에서 invalid_input이다.
  }
  return invalid(`package.json needs name and version: ${dir}`);
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
  const collected = await collectSourceFiles(dir, (path) =>
    keepSourceFile(path, skip),
  );
  if (!collected.ok) return collected;
  const vendored = await vendorFiles(
    identity.value.name,
    collected.value,
    packagesRoot,
  );
  if (!vendored.ok) return vendored;
  const prepared = prepareCopyFiles(
    identity.value.name,
    identity.value.version,
    vendored.value,
  );
  if (!prepared.ok) return prepared;
  return await installCopy(
    dataRoot,
    identity.value.name,
    identity.value.version,
    prepared.value,
  );
}

// packages/sdk/* 중 package.json이 있는 폴더 전부와 지원 소스를 `<dataRoot>/sdk/…`에 푼다.
// 하나라도 실패하면 그 err를 돌려주고 다음을 깔지 않는다.
export async function installSdkCopies(deps: {
  dataRoot: string;
  packagesRoot: string;
}): Promise<Result<{ name: string; version: string; install_path: string }[]>> {
  const sources: { source: string; skip: readonly string[] }[] = [];
  try {
    const names: string[] = [];
    for (const entry of await readdir(`${deps.packagesRoot}/sdk`, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) names.push(entry.name);
    }
    for (const name of names.sort()) {
      const source = `sdk/${name}`;
      try {
        await stat(`${deps.packagesRoot}/${source}/package.json`);
        sources.push({ source, skip: [] });
      } catch {
        // package.json이 없는 폴더는 판이 없어 깔지 않는다.
      }
    }
  } catch {
    return invalid(`sdk source is unreadable: ${deps.packagesRoot}/sdk`);
  }
  sources.push(...SUPPORT_SOURCES);
  const results = await Promise.all(
    sources.map(({ source, skip }) =>
      installSource(deps.dataRoot, deps.packagesRoot, source, skip),
    ),
  );
  const installed = [];
  for (const result of results) {
    if (!result.ok) return result;
    installed.push(result.value);
  }
  return ok(installed);
}
