// package 설치(package catalog과 설치).
// packages/sdk/<name>의 검증된 소스를 패키지마다 자기 완결 byte로 묶고, hash·guide
// hash를 blob으로 준비한 뒤 machine으로 register_version을 제출하고, 설치 사본을
// 설치 위치(`packageInstallPath`)의 파일 0444·디렉터리 0555로 풀어 놓는다.
// 여기서 설치하는 것은 packages/sdk/* 소스뿐이다. 사용자 package(@me)는 publish.ts가 낸다.

import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  packageNameSchema,
  type PackageRegisterVersionInput,
} from "../../../protocol/apps/mod.ts";
import { type SourceFile } from "./vendor.ts";

// 설치 worker가 core에 제출할 결과. hash·guide hash와 machine 제출 입력이다.

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

// 외부 Package 등록은 없다. supply 범위는 설치 제공 재료다.

// packages/sdk/<name>의 파일을 상대 경로와 함께 모은다.

// 사본이 packages/sdk/<name> 밖에서 가져오는 소스를 vendor/로 함께 담고 specifier를 바꾼다.

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

// 검증된 설치 내용만 설치한다.

// 지원 소스(@lophn/design·@lophn/wording·@lophn/chart)의 설치 사본. catalog에 등록하지 않으므로 guide·등록이 없다.

// 공용 UI Package가 import하는 지원 소스를 sdk/<name>/<version>/에 읽기 전용으로 풀어 놓는다.
// catalog Package가 아니라 register_version은 없다. 같은 byte면 hash도 같다.

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

// 설치 템플릿을 `<dataRoot>/templates/app/`에 읽기 전용(파일 0444·디렉터리 0555)으로 둔다.
// 내용은 고정 hash와 같을 때만 설치한다. 같은 byte의 사본이 있으면 그대로 두고, 다른 사본(옛 판)이면
// 새 판으로 바꾼다. 템플릿은 SDK Package가 아니라 catalog 등록은 없다.

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

// 설치된 사본이 정말 0444·0555인지 폴더 끝까지 본다. 테스트와 install checker가 쓴다.

// catalog read에서 쓰는 잡힌 조회. install 확인 내용만 목록에 남는다.
