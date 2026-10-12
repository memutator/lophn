// SDK 설치(package catalog과 설치, apps/sdk#R4, R8, R9, R11, R13).
// packages/sdk/<name>의 검증된 소스를 패키지마다 자기 완결 byte로 묶고, hash·guide
// hash를 blob으로 준비한 뒤 machine으로 register_version을 제출하고, 설치 사본을
// sdk/<name>/<version>/의 파일 0444·디렉터리 0555로 풀어 놓는다. 공개 마켓·외부
// Package 등록은 없다(R13) — packages/sdk/* 밖 이름은 거절이다.

import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  packageNameSchema,
  type PackageRegisterVersionInput,
} from "../../../protocol/apps/mod.ts";
import { isWithheldPackageName } from "./model.ts";
import {
  keepSupportFile,
  rewriteSpecifiers,
  type SourceFile,
  SUPPORT_PACKAGES,
  VENDOR_RULES,
} from "./vendor.ts";

// 설치 worker가 core에 제출할 결과. hash·guide hash와 machine 제출 입력이다.
export type InstallSubmission = {
  input: PackageRegisterVersionInput;
};

export type InstallDeps = {
  // lophn data root. 설치 사본 sdk/<name>/<version>/의 기준이다.
  dataRoot: string;
  // blob 준비 통로. 검사한 byte를 그대로 넣는다. 없으면 설치도 실패다.
  prepareBlob?: (input: {
    principal: string;
    purpose: string;
    bytes: ReadableStream<Uint8Array>;
  }) => Promise<
    Result<{ hash: string; size_bytes: number; preparation?: string }>
  >;
  // machine 제출. route 입력을 그대로 ledger command로 넣는다. 없으면 등록도 실패다.
  registerVersion?: (
    input: PackageRegisterVersionInput,
  ) => Promise<Result<unknown>>;
  // 설치 소스 경계. 제품은 packages/sdk/*를 쓴다(테스트가 주입한다).
  sourceRoot?: string;
  // packages/ 저장소 폴더. 사본이 가져오는 contracts·design 같은 지원 소스의 기준이다.
  packagesRoot?: string;
};

const PACKAGES_ROOT = new URL("../../../", import.meta.url).pathname
  .replace(/\/$/, "");

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// 외부 Package 등록은 없다(R13). supply 범위는 설치 제공 재료다.
function installRefused(name: string): Result<never> {
  return forbidden(`package ${name} is outside the install-provided SDK set`);
}

// packages/sdk/<name>의 파일을 상대 경로와 함께 모은다.
async function collectSourceFiles(
  root: string,
  keep: (path: string) => boolean = () => true,
): Promise<Result<SourceFile[]>> {
  const files: SourceFile[] = [];
  async function visit(
    directory: string,
    prefix: string,
  ): Promise<Result<void>> {
    let entries;
    try {
      entries = Deno.readDir(directory);
    } catch {
      return invalid(`package source directory is missing: ${prefix || "."}`);
    }
    for await (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        if (!keep(`${path}/`)) continue;
        const walked = await visit(target, path);
        if (!walked.ok) return walked;
      } else if (entry.isFile) {
        if (!keep(path)) continue;
        try {
          files.push({ path, bytes: await Deno.readFile(target) });
        } catch {
          return invalid(`package source file is unreadable: ${path}`);
        }
      }
    }
    return ok(undefined);
  }
  const walked = await visit(root, "");
  if (!walked.ok) return walked;
  if (files.length === 0) {
    return invalid("package source directory is empty");
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ok(files);
}

function sortFiles(files: SourceFile[]): SourceFile[] {
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 사본이 packages/sdk/<name> 밖에서 가져오는 소스를 vendor/로 함께 담고 specifier를 바꾼다(R9, R10).
async function vendorFiles(
  name: string,
  files: readonly SourceFile[],
  packagesRoot: string,
): Promise<Result<SourceFile[]>> {
  const rule = VENDOR_RULES[name];
  if (rule === undefined) return ok([...files]);
  const out = files.map((file) => rewriteSpecifiers(file, rule.rewrite));
  for (const [from, to] of Object.entries(rule.files)) {
    try {
      out.push({
        path: to,
        bytes: await Deno.readFile(`${packagesRoot}/${from}`),
      });
    } catch {
      return invalid(`vendored source is missing: ${from}`);
    }
  }
  for (const [path, text] of Object.entries(rule.generated ?? {})) {
    out.push({ path, bytes: new TextEncoder().encode(text) });
  }
  return ok(sortFiles(out));
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

export function splitPackageName(
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

// 검증된 설치 내용만 설치한다(R13).
export async function installPackage(
  name: string,
  description: string,
  kind: PackageRegisterVersionInput["kind"],
  version: string,
  guide: Uint8Array,
  deps: InstallDeps,
): Promise<Result<InstallResult>> {
  if (isWithheldPackageName(name)) {
    return installRefused(name);
  }
  // scope 검사를 이름 schema보다 먼저 해 catalog 밖 scope도 forbidden으로 거절이다(R13).
  const rawSlash = name.indexOf("/");
  const rawScope = rawSlash > 0
    ? safeNamePart(name.slice(1, rawSlash))
    : undefined;
  if (rawScope === undefined || rawScope !== "lophn") {
    return installRefused(name);
  }
  const split = splitPackageName(name);
  if (!split.ok) return split;
  const packagesRoot = deps.packagesRoot ?? PACKAGES_ROOT;
  const sourceRoot = deps.sourceRoot ?? `${packagesRoot}/sdk`;
  const source = `${sourceRoot}/${split.value.part}`;
  const collected = await collectSourceFiles(source);
  if (!collected.ok) return collected;
  const files = await vendorFiles(name, collected.value, packagesRoot);
  if (!files.ok) return files;
  const bundle = bundleBytes(files.value);
  const bundleHash = await sha256Hex(bundle);
  const guideHash = await sha256Hex(guide);
  // 준비 통로가 준비 참조를 주면 안내 blob을 register_version이 같은 transaction에서 등록한다.
  let guideBlob: PackageRegisterVersionInput["guide_blob"];

  // hash·guide hash를 blob으로 넣는다. 준비 통로가 없으면 등록도 없다. 검사한
  // byte의 hash만 제출한다(domain-model apps/sdk command 표).
  if (deps.prepareBlob) {
    const bundlePrepared = await deps.prepareBlob({
      principal: "machine:install",
      purpose: "sdk_bundle",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(bundle);
          controller.close();
        },
      }),
    });
    if (!bundlePrepared.ok) return bundlePrepared;
    if (bundlePrepared.value.hash !== bundleHash) {
      return invalid("bundle hash changed during preparation");
    }
    const guidePrepared = await deps.prepareBlob({
      principal: "machine:install",
      purpose: "sdk_guide",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(guide);
          controller.close();
        },
      }),
    });
    if (!guidePrepared.ok) return guidePrepared;
    if (guidePrepared.value.hash !== guideHash) {
      return invalid("guide hash changed during preparation");
    }
    if (guidePrepared.value.preparation !== undefined) {
      guideBlob = {
        preparation: guidePrepared.value.preparation,
        principal: "machine:install",
        purpose: "sdk_guide",
        hash: guidePrepared.value.hash,
        size_bytes: guidePrepared.value.size_bytes,
      };
    }
  }

  // machine으로 register_version을 부른다. 등록은 install machine의 몫이다.
  const submission: InstallSubmission = {
    input: {
      name,
      description,
      kind,
      version,
      bundle_hash: bundleHash,
      guide_hash: guideHash,
      ...(guideBlob === undefined ? {} : { guide_blob: guideBlob }),
    },
  };
  if (deps.registerVersion) {
    const registered = await deps.registerVersion(submission.input);
    if (!registered.ok) return registered;
  }

  // 설치 사본 sdk/<name>/<version>/. 파일 0444·디렉터리 0555(R9).
  const target = `${deps.dataRoot}/sdk/${split.value.part}/${version}`;
  const copied = await writeInstallCopy(target, files.value);
  if (!copied.ok) return copied;
  return ok({
    name,
    version,
    bundle_hash: bundleHash,
    guide_hash: guideHash,
    install_path: target,
    files: files.value.map((file) => file.path),
  });
}

// 지원 소스(@lophn/design·@lophn/wording)의 설치 사본. catalog에 등록하지 않으므로 guide·등록이 없다.
export type SupportInstallResult = {
  name: string;
  version: string;
  bundle_hash: string;
  install_path: string;
  files: readonly string[];
};

export type InstallResult = {
  name: string;
  version: string;
  bundle_hash: string;
  guide_hash: string;
  install_path: string;
  files: readonly string[];
};

// 공용 UI Package가 import하는 지원 소스를 sdk/<name>/<version>/에 읽기 전용으로 풀어 놓는다.
// catalog Package가 아니라 register_version은 없다(apps/sdk#R13). 같은 byte면 hash도 같다.
export async function installSupportPackage(
  name: string,
  deps: Pick<InstallDeps, "dataRoot" | "packagesRoot">,
): Promise<Result<SupportInstallResult>> {
  const support = SUPPORT_PACKAGES.find((item) => item.name === name);
  if (support === undefined) return installRefused(name);
  const split = splitPackageName(name);
  if (!split.ok) return split;
  const packagesRoot = deps.packagesRoot ?? PACKAGES_ROOT;
  const collected = await collectSourceFiles(
    `${packagesRoot}/${support.source}`,
    (path) => keepSupportFile(path, support),
  );
  if (!collected.ok) return collected;
  const files = sortFiles(collected.value);
  const target = `${deps.dataRoot}/sdk/${split.value.part}/${support.version}`;
  // 같은 byte의 사본이 이미 있으면 그대로 둔다. 읽기 전용 사본을 다시 쓰지 않는다(R8, R9).
  if (!await sameInstallCopy(target, files)) {
    const copied = await writeInstallCopy(target, files);
    if (!copied.ok) return copied;
  }
  return ok({
    name,
    version: support.version,
    bundle_hash: await sha256Hex(bundleBytes(files)),
    install_path: target,
    files: files.map((file) => file.path),
  });
}

export type TemplateInstallResult = {
  hash: string;
  install_path: string;
  files: readonly string[];
};

async function removeInstallCopy(target: string): Promise<void> {
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

// 설치 템플릿을 `<dataRoot>/templates/app/`에 읽기 전용(파일 0444·디렉터리 0555)으로 둔다(apps/sdk#R35).
// 내용은 고정 hash와 같을 때만 설치한다. 같은 byte의 사본이 있으면 그대로 두고, 다른 사본(옛 판)이면
// 새 판으로 바꾼다. 템플릿은 SDK Package가 아니라 catalog 등록은 없다.
export async function installTemplate(
  files: readonly SourceFile[],
  expectedHash: string,
  deps: Pick<InstallDeps, "dataRoot">,
): Promise<Result<TemplateInstallResult>> {
  const sorted = sortFiles([...files]);
  const hash = await sha256Hex(bundleBytes(sorted));
  if (hash !== expectedHash) {
    return invalid("template content does not match its pinned hash");
  }
  const target = `${deps.dataRoot}/templates/app`;
  if (!await sameInstallCopy(target, sorted)) {
    await removeInstallCopy(target);
    const copied = await writeInstallCopy(target, sorted);
    if (!copied.ok) return copied;
  }
  return ok({
    hash,
    install_path: target,
    files: sorted.map((file) => file.path),
  });
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
      // 깊은 파일의 중간 폴더도 모두 0555로 좁힌다(R9).
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
  // 사본 디렉터리는 모두 0555다(R9). 깊은 곳부터 좁힌다.
  for (const directory of [...directories].reverse()) {
    try {
      await Deno.chmod(directory, 0o555);
    } catch {
      // 이미 0555면 없어도 된다.
    }
  }
  return ok(undefined);
}

// 설치된 사본이 정말 0444·0555인지 폴더 끝까지 본다(R9). 테스트와 install checker가 쓴다.
export async function verifyInstallPermissions(
  target: string,
): Promise<Result<void>> {
  let stat;
  try {
    stat = await Deno.stat(target);
  } catch {
    return invalid("install copy is missing");
  }
  if (!stat.isDirectory) return invalid("install copy is not a directory");
  async function visit(path: string, label: string): Promise<Result<void>> {
    const info = await Deno.stat(path);
    if (((info.mode ?? 0) & 0o222) !== 0) {
      return invalid(
        `install copy ${
          info.isDirectory ? "directory" : "file"
        } is writable: ${label}`,
      );
    }
    if (!info.isDirectory) return ok(undefined);
    for await (const entry of Deno.readDir(path)) {
      const visited = await visit(
        `${path}/${entry.name}`,
        label === "." ? entry.name : `${label}/${entry.name}`,
      );
      if (!visited.ok) return visited;
    }
    return ok(undefined);
  }
  return await visit(target, ".");
}

// catalog read에서 쓰는 잡힌 조회. install 확인 내용만 목록에 남는다(R13).
export function verifiedOnly(
  registered: readonly { name: string }[],
  name: string,
): boolean {
  return registered.some((pkg) => pkg.name === name);
}
