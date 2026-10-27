// 앱 import map을 bundle 안 상대 경로로 잠근다. 앱 deno.json의
// `lophn-sdk:<name>@<version>/<경로>`는 bundle 안 설치 사본(`packageInstallPath`)의 `./<설치 경로>/<경로>`로
// 바뀌고, npm·jsr는 정확한 pin만 남는다(받아서 bundle에 담는 것은 prepare/from-source.ts다).
// 범위 version과 원격 import는 잠그지 못하고 거절이다.
import { readdir, readFile } from "node:fs/promises";

import { err, ok, type Result } from "../../../../base/mod.ts";
import { packageNameSchema } from "../../../../protocol/apps/mod.ts";
import { packageInstallPath } from "../../packages/install.ts";

type LockFailure = {
  code: "invalid_input";
  reason:
    | "range_version"
    | "remote_import"
    | "unknown_sdk"
    | "escaped_relative";
  specifier: string;
};

type SdkRef = { name: string; version: string };

const SDK_VALUE = /^lophn-sdk:(@[^/@]+\/[^/@]+)@([^/@]+)(?:\/(.+))?$/;
const EXACT_PIN =
  /^(?:npm|jsr):(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\/.*)?$/;
const RANGE = /[~^*]|@latest|@next|@x\b/;

const EXTERNAL_VALUE =
  /^(npm|jsr):((?:@[^/@]+\/)?[^/@]+)@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\/.*)?$/;

type ExternalRef = {
  name: string;
  version: string;
  source: "npm" | "jsr";
};

type LockedImports = {
  imports: Record<string, string>;
  // 잠근 값이 가리키는 설치 사본. bundle은 이 사본의 byte를 `packageInstallPath` 아래에 담는다.
  packages: SdkRef[];
  // 정확한 pin으로 잠근 npm·jsr 의존. 준비가 받아서 bundle에 담는다.
  external: ExternalRef[];
};

export function lockAppImports(
  imports: Readonly<Record<string, string>>,
): Result<LockedImports, LockFailure> {
  const locked: Record<string, string> = {};
  const packages = new Map<string, SdkRef>();
  const external = new Map<string, ExternalRef>();
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
      const installed = packageInstallPath(name, version);
      if (!installed.ok) {
        return err({
          code: "invalid_input",
          reason: "unknown_sdk",
          specifier: key,
        });
      }
      packages.set(`${name}@${version}`, { name, version });
      locked[key] = `./${installed.value}/${path ?? ""}`;
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
      const pin = EXTERNAL_VALUE.exec(value)!;
      const source = pin[1] as "npm" | "jsr";
      external.set(`${source}:${pin[2]}@${pin[3]}`, {
        name: pin[2],
        version: pin[3],
        source,
      });
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
  const byName = (a: SdkRef, b: SdkRef) =>
    a.name === b.name
      ? a.version < b.version ? -1 : 1
      : a.name < b.name
      ? -1
      : 1;
  return ok({
    imports: sorted,
    packages: [...packages.values()].sort(byName),
    external: [...external.values()].sort((a, b) =>
      a.source === b.source ? byName(a, b) : a.source < b.source ? -1 : 1
    ),
  });
}

// 설치 사본(`<dataRoot>/<packageInstallPath>/`)의 byte를 bundle 안 같은 상대 경로의 파일로 읽는다.
// 설치 안 된 사본은 준비를 막는다. 실행 때 새로 받지 않는다.
async function collect(
  directory: string,
  prefix: string,
  files: { path: string; bytes: Uint8Array }[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collect(`${directory}/${entry.name}`, path, files);
    } else if (entry.isFile()) {
      files.push({
        path,
        bytes: await readFile(`${directory}/${entry.name}`),
      });
    }
  }
}

export async function readSdkCopies(
  dataRoot: string,
  packages: readonly SdkRef[],
): Promise<
  Result<
    { path: string; bytes: Uint8Array }[],
    { code: "invalid_input"; reason: "sdk_not_installed"; specifier: string }
  >
> {
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const item of packages) {
    const base = packageInstallPath(item.name, item.version);
    try {
      if (!base.ok) throw new Error("not installable");
      await collect(`${dataRoot}/${base.value}`, base.value, files);
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
