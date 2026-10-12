// lophn-sdk import map(apps/sdk#R7, R10, R34). `lophn-sdk:<name>@<version>`와
// `lophn-sdk:<name>@<version>/<subpath>`를 bundle 안 상대 file 경로로 치환한다.
// 상대 specifier(`./`, `../`)는 허용한다. ^·~·latest와 원격·npm·jsr import는 거절이다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  packageNameSchema,
  packageVersionNameSchema,
} from "../../../../protocol/apps/mod.ts";

export type ImportMapFailure = {
  code: "invalid_input";
  reason:
    | "range_version"
    | "unknown_sdk"
    | "remote_import"
    | "npm_import"
    | "jsr_import"
    | "escaped_relative";
};

const RANGE_PREFIX = /^[~^]/;
const RANGE_WORDS = new Set(["latest", "next", "x"]);

export type SdkPathMap = ReadonlyMap<string, string>;

export type ParsedSdkSpecifier = {
  name: string;
  version: string;
  subpath: string;
};

// `@lophn/name@version`과 `@lophn/name@version/subpath`를 나눈다.
// version과 subpath를 한 토큰으로 보지 않는다.
export function parseSdkSpecifier(
  specifier: string,
): ParsedSdkSpecifier | undefined {
  if (!specifier.startsWith("lophn-sdk:")) return undefined;
  const body = specifier.slice("lophn-sdk:".length);
  const at = body.lastIndexOf("@");
  if (at <= 0) return undefined;
  const name = body.slice(0, at);
  const rest = body.slice(at + 1);
  const slash = rest.indexOf("/");
  const version = slash < 0 ? rest : rest.slice(0, slash);
  const subpath = slash < 0 ? "" : rest.slice(slash + 1);
  if (!packageNameSchema.safeParse(name).success) return undefined;
  if (!packageVersionNameSchema.safeParse(version).success) return undefined;
  if (
    subpath.split("/").some((part) =>
      part === "" || part === "." || part === ".."
    )
  ) {
    return undefined;
  }
  return { name, version, subpath };
}

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

function relativeStays(specifier: string): Result<string, ImportMapFailure> {
  if (specifier.split("/").includes("..") && specifier.startsWith("../")) {
    // `../`는 같은 bundle 안 상대다. root 밖으로 나가는지는 파일 경로 검사(seal)가 한다.
    return ok(specifier);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return ok(specifier);
  }
  return err({ code: "invalid_input", reason: "escaped_relative" });
}

// specifier 하나를 bundle 안 상대 경로로 바꾼다. map에 없는 이름은 거절이다
// (실행 때 새 패키지를 다운로드하지 않는다, apps/sdk#R10).
export function resolveSpecifier(
  specifier: string,
  map: SdkPathMap,
): Result<string, ImportMapFailure> {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return relativeStays(specifier);
  }
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
    const parsed = parseSdkSpecifier(specifier);
    if (parsed === undefined) {
      const version = specifier.slice(specifier.lastIndexOf("@") + 1);
      const versionOnly = version.split("/")[0] ?? version;
      if (RANGE_PREFIX.test(versionOnly) || RANGE_WORDS.has(versionOnly)) {
        return err({ code: "invalid_input", reason: "range_version" });
      }
      return err({ code: "invalid_input", reason: "unknown_sdk" });
    }
    const base = map.get(`lophn-sdk:${parsed.name}@${parsed.version}`);
    if (base === undefined) {
      return err({ code: "invalid_input", reason: "unknown_sdk" });
    }
    return ok(parsed.subpath === "" ? base : `${base}${parsed.subpath}`);
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
// SDK specifier만 bundle 안 상대 경로로 풀어 놓는다. 상대 specifier는 파일 그대로다.
export function lockedImportMap(
  dependencies: readonly { name: string; version: string }[],
): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const [specifier, path] of sdkPathMap(dependencies)) {
    imports[specifier] = path;
  }
  return { imports };
}
