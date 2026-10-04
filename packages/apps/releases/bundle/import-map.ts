// lophn-sdk import map(apps/sdk#R7, R10). `lophn-sdk:<name>@<version>` specifier를
// bundle 안 상대 file 경로로 치환한다. ^·~·latest와 원격·npm·jsr import는 거절이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  packageNameSchema,
  packageVersionNameSchema,
} from "../../../contracts/apps/mod.ts";

export type ImportMapFailure = {
  code: "invalid_input";
  reason:
    | "range_version"
    | "unknown_sdk"
    | "remote_import"
    | "npm_import"
    | "jsr_import";
};

const RANGE_PREFIX = /^[~^]/;
const RANGE_WORDS = new Set(["latest", "next", "x"]);

export type SdkPathMap = ReadonlyMap<string, string>;

// bundle 안 이름별 경로표. sdk/<name>/<version>/의 그 version 사본이다.
export function sdkPathMap(
  dependencies: readonly { name: string; version: string }[],
): SdkPathMap {
  const map = new Map<string, string>();
  for (const dependency of dependencies) {
    map.set(
      `lophn-sdk:${dependency.name}@${dependency.version}`,
      `sdk/${dependency.name}/${dependency.version}/`,
    );
  }
  return map;
}

// specifier 하나를 bundle 안 상대 경로로 바꾼다. map에 없는 이름은 거절이다
// (실행 때 새 패키지를 다운로드하지 않는다, apps/sdk#R10).
export function resolveSpecifier(
  specifier: string,
  map: SdkPathMap,
): Result<string, ImportMapFailure> {
  const bare =
    /^[a-z@][^:]*:/.test(specifier) === false && !/[./]/.test(specifier)
      ? specifier
      : undefined;
  if (bare !== undefined) {
    return err({ code: "invalid_input", reason: "remote_import" });
  }
  const mapped = map.get(specifier);
  if (mapped !== undefined) return ok(mapped);
  if (specifier.startsWith("npm:")) {
    return err({ code: "invalid_input", reason: "npm_import" });
  }
  if (specifier.startsWith("jsr:")) {
    return err({ code: "invalid_input", reason: "jsr_import" });
  }
  if (/^https?:\/\//.test(specifier)) {
    return err({ code: "invalid_input", reason: "remote_import" });
  }
  if (specifier.startsWith("lophn-sdk:")) {
    const version = specifier.slice(specifier.lastIndexOf("@") + 1);
    if (RANGE_PREFIX.test(version) || RANGE_WORDS.has(version)) {
      return err({ code: "invalid_input", reason: "range_version" });
    }
    return err({ code: "invalid_input", reason: "unknown_sdk" });
  }
  return err({ code: "invalid_input", reason: "remote_import" });
}

// 의존 선언의 version이 정확한 SemVer인지 본다. ^·~·latest는 선언도 받지 않는다.
export function validDependencyVersion(version: string): boolean {
  return packageVersionNameSchema.safeParse(version).success &&
    !RANGE_PREFIX.test(version) && !RANGE_WORDS.has(version);
}

export function validDependencyName(name: string): boolean {
  return packageNameSchema.safeParse(name).success;
}

// bundle 잠금 import map(플랫폼 생성 고정 import map, architecture/apps 2.3).
// SDK specifier만 bundle 안 상대 경로로 풀어 놓는다.
export function lockedImportMap(
  dependencies: readonly { name: string; version: string }[],
): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const [specifier, path] of sdkPathMap(dependencies)) {
    imports[specifier] = path;
  }
  return { imports };
}
