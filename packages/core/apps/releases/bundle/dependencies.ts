// 앱 `package.json`의 의존 값을 bundle에 담을 수 있는 모양으로 잠근다. Node는 npm의 값으로 module을 풀므로
// 앱이 쓴 값이 그대로 설치·bundle된다. 정확한 판과 `.lophn/sdk/...` 사본만 받고, 범위·원격·사본 밖 경로는
// release 준비를 거절한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { semver } from "../../../../protocol/apps/declaration/scope.ts";
import type { BundleManifest } from "../../../../protocol/apps/mod.ts";
import { packageInstallPath } from "../../packages/install.ts";

type DependencyFailure = {
  code: "invalid_input";
  reason:
    | "range_version"
    | "remote_import"
    | "unknown_sdk"
    | "escaped_relative";
  specifier: string;
};

export type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Dependency = BundleManifest["dependencies"][number];

const FILE_PREFIX = "file:";
const SDK_FOLDER = ".lophn/sdk/";
// `..`·절대 경로·home은 앱 폴더 밖이다. `npm:`·`link:`·URL로 시작하는 값도 여기로 오지 않는다.
const ESCAPED = /^(?:\.{1,2}(?:\/|$)|\/|~\/)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function failed(
  reason: DependencyFailure["reason"],
  specifier: string,
): Result<never, DependencyFailure> {
  return err({ code: "invalid_input", reason, specifier });
}

// `file:` 값이 가리키는 설치 사본(`sdk/<이름>/<판>`, `sdk/@me/<이름>/<판>`)에서 판을 읽는다.
// 이름이 사본의 이름과 다르거나 사본 꼴이 아니면 unknown_sdk다.
function sdkVersion(
  name: string,
  path: string,
): Result<string, DependencyFailure> {
  if (!path.startsWith(SDK_FOLDER)) return failed("unknown_sdk", name);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return failed("escaped_relative", name);
  }
  const rest = path.slice(SDK_FOLDER.length);
  const scoped = rest.startsWith("@me/");
  const segments = (scoped ? rest.slice("@me/".length) : rest).split("/");
  if (segments.length !== 2) return failed("unknown_sdk", name);
  const [part, version] = segments;
  const expected = scoped ? `@me/${part}` : `@lophn/${part}`;
  if (expected !== name || !semver(version)) {
    return failed("unknown_sdk", name);
  }
  const installable = packageInstallPath(name, version);
  if (!installable.ok || installable.value !== `sdk/${rest}`) {
    return failed("unknown_sdk", name);
  }
  return ok(version);
}

function dependencyOf(
  name: string,
  value: string,
): Result<Dependency, DependencyFailure> {
  if (value.startsWith(FILE_PREFIX)) {
    const path = value.slice(FILE_PREFIX.length).replace(/^\.\//, "");
    if (ESCAPED.test(path) || path.split("/").includes("..")) {
      return failed("escaped_relative", name);
    }
    const version = sdkVersion(name, path);
    if (!version.ok) return version;
    return ok({
      name,
      version: version.value,
      source: name.startsWith("@me/") ? "package" : "sdk",
    });
  }
  if (ESCAPED.test(value)) return failed("escaped_relative", name);
  if (SCHEME.test(value)) return failed("remote_import", name);
  if (!semver(value)) return failed("range_version", name);
  return ok({ name, version: value, source: "npm" });
}

// dependencies와 devDependencies 모두 npm이 받아 bundle에 담기므로 같은 규칙으로 본다.
// 같은 이름이 둘 다에 있으면 npm처럼 dependencies를 쓴다.
export function appDependencies(
  manifest: PackageManifest,
): Result<BundleManifest["dependencies"], DependencyFailure> {
  const values = { ...manifest.devDependencies, ...manifest.dependencies };
  const dependencies: Dependency[] = [];
  for (const name of Object.keys(values).sort()) {
    const dependency = dependencyOf(name, values[name]);
    if (!dependency.ok) return dependency;
    dependencies.push(dependency.value);
  }
  return ok(dependencies);
}
