// 앱 import map을 bundle 안 상대 경로로 잠근다(apps/sdk#R7, R10, R34). 앱 deno.json의
// `lophn-sdk:<name>@<version>/<경로>`는 bundle 안 설치 사본 `./sdk/<이름>/<version>/<경로>`로 바뀌고,
// npm·jsr는 정확한 pin만 남는다. 범위 version과 원격 import는 잠그지 못하고 거절이다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { packageNameSchema } from "../../../../protocol/apps/mod.ts";

export type LockFailure = {
  code: "invalid_input";
  reason:
    | "range_version"
    | "remote_import"
    | "unknown_sdk"
    | "escaped_relative";
  specifier: string;
};

export type SdkRef = { name: string; version: string };

const SDK_VALUE = /^lophn-sdk:(@[^/@]+\/[^/@]+)@([^/@]+)(?:\/(.+))?$/;
const EXACT_PIN =
  /^(?:npm|jsr):(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\/.*)?$/;
const RANGE = /[~^*]|@latest|@next|@x\b/;

function installPart(name: string): string {
  return name.slice(name.indexOf("/") + 1);
}

export type LockedImports = {
  imports: Record<string, string>;
  // 잠근 값이 가리키는 설치 사본. bundle은 이 사본의 byte를 `sdk/<이름>/<version>/`에 담는다.
  packages: SdkRef[];
};

export function lockAppImports(
  imports: Readonly<Record<string, string>>,
): Result<LockedImports, LockFailure> {
  const locked: Record<string, string> = {};
  const packages = new Map<string, SdkRef>();
  for (const [key, value] of Object.entries(imports)) {
    const sdk = SDK_VALUE.exec(value);
    if (sdk !== null) {
      const [, name, version, path] = sdk;
      if (!packageNameSchema.safeParse(name).success) {
        return err({
          code: "invalid_input",
          reason: "unknown_sdk",
          specifier: key,
        });
      }
      if (RANGE.test(version) || !/^\d+\.\d+\.\d+/.test(version)) {
        return err({
          code: "invalid_input",
          reason: "range_version",
          specifier: key,
        });
      }
      packages.set(`${name}@${version}`, { name, version });
      locked[key] = `./sdk/${installPart(name)}/${version}/${path ?? ""}`;
      continue;
    }
    if (value.startsWith("npm:") || value.startsWith("jsr:")) {
      if (!EXACT_PIN.test(value) || RANGE.test(value)) {
        return err({
          code: "invalid_input",
          reason: "range_version",
          specifier: key,
        });
      }
      locked[key] = value;
      continue;
    }
    if (value.startsWith("./")) {
      if (value.split("/").includes("..")) {
        return err({
          code: "invalid_input",
          reason: "escaped_relative",
          specifier: key,
        });
      }
      locked[key] = value;
      continue;
    }
    return err({
      code: "invalid_input",
      reason: value.startsWith("../") ? "escaped_relative" : "remote_import",
      specifier: key,
    });
  }
  const sorted = Object.fromEntries(
    Object.entries(locked).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return ok({
    imports: sorted,
    packages: [...packages.values()].sort((a, b) =>
      a.name === b.name
        ? a.version < b.version ? -1 : 1
        : a.name < b.name
        ? -1
        : 1
    ),
  });
}

// 설치 사본(`<sdkRoot>/<이름>/<version>/`)의 byte를 bundle 안 `sdk/<이름>/<version>/` 파일로 읽는다.
// 설치 안 된 사본은 준비를 막는다. 실행 때 새로 받지 않는다(apps/sdk#R10).
async function collect(
  directory: string,
  prefix: string,
  files: { path: string; bytes: Uint8Array }[],
): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(`${directory}/${entry.name}`, path, files);
    } else if (entry.isFile) {
      files.push({
        path,
        bytes: await Deno.readFile(`${directory}/${entry.name}`),
      });
    }
  }
}

export async function readSdkCopies(
  sdkRoot: string,
  packages: readonly SdkRef[],
): Promise<
  Result<
    { path: string; bytes: Uint8Array }[],
    { code: "invalid_input"; reason: "sdk_not_installed"; specifier: string }
  >
> {
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const item of packages) {
    const base = `sdk/${installPart(item.name)}/${item.version}`;
    try {
      await collect(
        `${sdkRoot}/${installPart(item.name)}/${item.version}`,
        base,
        files,
      );
    } catch {
      return err({
        code: "invalid_input",
        reason: "sdk_not_installed",
        specifier: `${item.name}@${item.version}`,
      });
    }
  }
  return ok(files.sort((a, b) => (a.path < b.path ? -1 : 1)));
}
