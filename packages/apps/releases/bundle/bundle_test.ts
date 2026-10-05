// bundle manifest·hash·import map(apps/releases#R1, apps/sdk#R7, R34). 같은
// commit·SDK에서 같은 bundle hash고 source·SDK 최신판을 바꿔도 기존 선언은
// 불변이다(R1). lophn-sdk import map을 bundle 안 상대 경로로 바꾸고 ^·~·latest와
// 원격·npm·jsr import는 거절이다(R7, R34).
import { assert, assertEquals } from "@std/assert";
import { buildManifest, manifestBytes, parseManifest } from "./manifest.ts";
import {
  lockedImportMap,
  parseSdkSpecifier,
  resolveSpecifier,
  sdkPathMap,
  validDependencyName,
  validDependencyVersion,
} from "./import-map.ts";
import {
  BLUEPRINT_COPY_NAME,
  bundleCopyPath,
  MANIFEST_COPY_NAME,
  sealBundle,
  verifySealedPermissions,
} from "./seal.ts";
import { buildManifest as sealManifest } from "./manifest.ts";

// hash 값은 sha256Schema의 64-hex다.
const FILES = [
  { path: "main.js", hash: "aa".repeat(32) },
  { path: "screens/one.js", hash: "bb".repeat(32) },
];
const SDKS = [
  { name: "@lophn/blueprint", version: "1.2.3" },
  { name: "@me/sample", version: "0.1.0" },
];

Deno.test("apps/releases#R1: manifest가 entrypoint·파일 hash·sdk_dependencies를 담는다", () => {
  const manifest = buildManifest({
    entrypoint: "main.js",
    files: FILES,
    sdk_dependencies: SDKS,
  });
  assert(manifest.ok);
  assertEquals(manifest.value.entrypoint, "main.js");
  assertEquals(manifest.value.files, FILES);
  assertEquals(manifest.value.sdk_dependencies, SDKS);
  // schema에 맞지 않은 manifest는 거절이다.
  const broken = parseManifest({ entrypoint: "main.js" });
  assertEquals(broken.ok, false);
  // 파일 hash가 중복되는 manifest도 거절이다.
  const duplicated = parseManifest({
    entrypoint: "main.js",
    files: [FILES[0], FILES[0]],
    sdk_dependencies: [],
  });
  assertEquals(duplicated.ok, false);
});

Deno.test("apps/releases#R1: 같은 commit·SDK에서 같은 bundle hash다", () => {
  // manifest + 파일 바이트 hash의 결정성. 같은 입력은 같은 byte다.
  const manifest = buildManifest({
    entrypoint: "main.js",
    files: FILES,
    sdk_dependencies: SDKS,
  });
  assert(manifest.ok);
  const same = buildManifest({
    entrypoint: "main.js",
    files: FILES,
    sdk_dependencies: SDKS,
  });
  assert(same.ok);
  assertEquals(manifestBytes(manifest.value), manifestBytes(same.value));
  const other = buildManifest({
    entrypoint: "main.js",
    files: [{ path: "main.js", hash: "cc".repeat(32) }],
    sdk_dependencies: SDKS,
  });
  assert(other.ok);
  assertEquals(
    manifestBytes(manifest.value) === manifestBytes(other.value),
    false,
  );
  // 기존 manifest byte는 source·SDK 최신판을 바꿔도 그대로다. 같은 commit·SDK
  // 입력의 같은 byte라 다시 봉인해도 기존 bundle 선언이 불변이다(R1).
  const reread = parseManifest(JSON.parse(
    new TextDecoder().decode(manifestBytes(manifest.value)),
  ));
  assert(reread.ok);
  assertEquals(manifestBytes(reread.value), manifestBytes(manifest.value));
});

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";

Deno.test("apps/releases#R1: bundle 사본 root에 정규 blueprint.json 자리가 있다", () => {
  // 사본 위치 규칙 apps/<app ID>/bundles/<bundle hash>/. hash도 64-hex다.
  const copy = bundleCopyPath("/data", APP, "dd".repeat(32));
  assert(copy.ok);
  assertEquals(
    copy.value,
    `/data/apps/${APP}/bundles/${"dd".repeat(32)}`,
  );
  // 사본 안의 정규 blueprint.json과 source map 고정 이름.
  assertEquals(BLUEPRINT_COPY_NAME, "blueprint.json");
});

Deno.test("apps/releases#R1: app id와 hash가 아니면 data root 밖으로 나가지 않는다", () => {
  const escaped = bundleCopyPath("/data", "../etc", "dd".repeat(32));
  assertEquals(escaped.ok, false);
  const slashed = bundleCopyPath("/data", "app/../../etc", "aa".repeat(32));
  assertEquals(slashed.ok, false);
  const short = bundleCopyPath("/data", APP, "../secret");
  assertEquals(short.ok, false);
  const upper = bundleCopyPath("/data", APP, "AA".repeat(32));
  assertEquals(upper.ok, false);
});

Deno.test("apps/releases#R1: ..와 절대 경로는 봉인하지 않고 파일은 0444다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-bundle-seal-" });
  const copy = bundleCopyPath(home, APP, "ee".repeat(32));
  assert(copy.ok);
  const manifest = sealManifest({
    entrypoint: "main.js",
    files: FILES,
    sdk_dependencies: SDKS,
  });
  assert(manifest.ok);
  const escaped = await sealBundle({
    copyPath: copy.value,
    manifest: manifest.value,
    blueprintJson: new Uint8Array([1]),
    bundleFiles: [{ path: "../outside.js", bytes: new Uint8Array([2]) }],
  });
  assertEquals(escaped.ok, false);
  const absolute = await sealBundle({
    copyPath: copy.value,
    manifest: manifest.value,
    blueprintJson: new Uint8Array([1]),
    bundleFiles: [{ path: "/tmp/outside.js", bytes: new Uint8Array([2]) }],
  });
  assertEquals(absolute.ok, false);
  const sealed = await sealBundle({
    copyPath: copy.value,
    manifest: manifest.value,
    blueprintJson: new TextEncoder().encode("{}\n"),
    bundleFiles: [{
      path: "screens/one.js",
      bytes: new TextEncoder().encode("export const one = 1;\n"),
    }],
    sourceMap: {
      path: "app.js.map",
      bytes: new TextEncoder().encode("{}\n"),
    },
  });
  assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
  const permissions = await verifySealedPermissions(copy.value);
  assert(permissions.ok, permissions.ok ? "" : permissions.error.message);
  const manifestBytes = await Deno.readFile(
    `${copy.value}/${MANIFEST_COPY_NAME}`,
  );
  assert(manifestBytes.byteLength > 0);
  const nested = await Deno.stat(`${copy.value}/screens`);
  assertEquals((nested.mode ?? 0) & 0o777, 0o555);
  const file = await Deno.stat(`${copy.value}/screens/one.js`);
  assertEquals((file.mode ?? 0) & 0o777, 0o444);
  await Deno.chmod(copy.value, 0o755);
  await Deno.chmod(`${copy.value}/screens`, 0o755);
  await Deno.remove(home, { recursive: true });
});

Deno.test("apps/sdk#R7: lophn-sdk import map을 bundle 안 상대 경로로 바꾼다", () => {
  const map = sdkPathMap(SDKS);
  // mapped specifier는 그 version 사본 상대 경로다.
  const mapped = resolveSpecifier("lophn-sdk:@lophn/blueprint@1.2.3", map);
  assert(mapped.ok);
  assertEquals(mapped.value, "sdk/@lophn/blueprint/1.2.3/");
  // 잠긴 import map도 같은 표를 만든다.
  assertEquals(lockedImportMap(SDKS), {
    imports: {
      "lophn-sdk:@lophn/blueprint@1.2.3": "sdk/@lophn/blueprint/1.2.3/",
      "lophn-sdk:@me/sample@0.1.0": "sdk/@me/sample/0.1.0/",
    },
  });
});

Deno.test("apps/sdk#R7: ^·~·latest와 map에 없는 SDK는 거절이다", () => {
  const map = sdkPathMap(SDKS);
  for (
    const specifier of [
      "lophn-sdk:@lophn/blueprint@^1.2.3",
      "lophn-sdk:@lophn/blueprint@~1.2.3",
      "lophn-sdk:@lophn/blueprint@latest",
    ]
  ) {
    const refused = resolveSpecifier(specifier, map);
    assertEquals(refused.ok, false, specifier);
    if (!refused.ok) assertEquals(refused.error.reason, "range_version");
  }
  // map에 없는 exact SDK도 거절이다(실행 때 다운로드하지 않는다, apps/sdk#R10).
  const unknown = resolveSpecifier("lophn-sdk:@lophn/blueprint@9.9.9", map);
  assertEquals(unknown.ok, false);
  if (!unknown.ok) assertEquals(unknown.error.reason, "unknown_sdk");
  // 의존 선언 단계도 같은 규칙이다.
  assertEquals(validDependencyVersion("^1.2.3"), false);
  assertEquals(validDependencyVersion("latest"), false);
  assertEquals(validDependencyVersion("1.2.3"), true);
  assertEquals(validDependencyName("@lophn/blueprint"), true);
  assertEquals(validDependencyName("blueprint"), false);
});

Deno.test("apps/sdk#R34: 상대 specifier와 version 뒤 subpath는 허용이다", () => {
  const map = sdkPathMap(SDKS);
  const relative = resolveSpecifier("./screens/one.js", map);
  assert(relative.ok);
  assertEquals(relative.value, "./screens/one.js");
  const parent = resolveSpecifier("../lib/util.js", map);
  assert(parent.ok);
  assertEquals(parent.value, "../lib/util.js");
  const parsed = parseSdkSpecifier(
    "lophn-sdk:@lophn/blueprint@1.2.3/screens/one.js",
  );
  assertEquals(parsed, {
    name: "@lophn/blueprint",
    version: "1.2.3",
    subpath: "screens/one.js",
  });
  const sub = resolveSpecifier(
    "lophn-sdk:@lophn/blueprint@1.2.3/screens/one.js",
    map,
  );
  assert(sub.ok);
  assertEquals(sub.value, "sdk/@lophn/blueprint/1.2.3/screens/one.js");
  // version과 subpath를 한 토큰으로 보면 SemVer 검사가 실패한다.
  assertEquals(
    parseSdkSpecifier("lophn-sdk:@lophn/blueprint@1.2.3/screens/one.js")
      ?.version,
    "1.2.3",
  );
});

Deno.test("apps/sdk#R34: 원격·npm·jsr import는 거절이다", () => {
  const map = sdkPathMap(SDKS);
  const cases: [string, "remote_import" | "npm_import" | "jsr_import"][] = [
    ["https://example.com/pkg/mod.ts", "remote_import"],
    ["npm:left-pad@1.0.0", "npm_import"],
    ["jsr:@std/assert@1.0.0", "jsr_import"],
    ["bare-import", "remote_import"],
  ];
  for (const [specifier, reason] of cases) {
    const refused = resolveSpecifier(specifier, map);
    assertEquals(refused.ok, false, specifier);
    if (!refused.ok) assertEquals(refused.error.reason, reason);
  }
});
