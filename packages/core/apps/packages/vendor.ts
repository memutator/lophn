// 설치 사본을 자기 완결로 만드는 규칙.
// 설치 사본(sdk/<name>/<version>/)은 앱 bundle 안에서 packages/ 저장소 없이 읽힌다. 그래서 사본이
// packages/sdk/<name> 밖의 소스를 가져오는 자리는 설치가 사본 안 vendor/로 함께 담고 specifier를
// 사본 안 상대 경로로 바꾼다. 원본 파일은 고치지 않고, 바꾼 byte가 사본의 hash가 된다.

export type SourceFile = { path: string; bytes: Uint8Array };

export type VendorRule = {
  // 저장소 packages/ 기준 원본 → 사본 안 위치.
  files: Readonly<Record<string, string>>;
  // 사본 안 파일의 specifier → 사본 안 대상 경로. 파일 위치 기준 상대 specifier로 바뀐다.
  rewrite: Readonly<Record<string, string>>;
  // 사본에 더할 파일(타입만 내보내는 얇은 mod 등).
  generated?: Readonly<Record<string, string>>;
};

const BLUEPRINT_FILES = [
  "mod.ts",
  "types.ts",
  "json.ts",
  "schema.ts",
  "scope.ts",
  "uses.ts",
  "app-api.ts",
  "value.ts",
];

// 임시: sdk/blueprint/mod.ts가 옛 평면 파일의 CommandDeclaration type을 아직 다시 내보낸다.
// app-calls-shell이 그 export를 지우면 이 목록도 지운다.
const BLUEPRINT_OLD_CONTRACT = [
  "blueprint.ts",
  "blueprint-commands.ts",
  "blueprint-json.ts",
  "blueprint-schema.ts",
  "blueprint-scope.ts",
  "blueprint-types.ts",
  "blueprint-uses.ts",
  "blueprint-value.ts",
];

// @lophn/blueprint: 정본 검증기는 protocol/apps/blueprint의 의존성 없는 파일들이다(read.ts는 zod를 써서 뺀다).
const BLUEPRINT: VendorRule = {
  files: {
    ...Object.fromEntries(
      BLUEPRINT_FILES.map((
        file,
      ) => [
        `protocol/apps/blueprint/${file}`,
        `vendor/protocol/apps/blueprint/${file}`,
      ]),
    ),
    ...Object.fromEntries(
      BLUEPRINT_OLD_CONTRACT.map((
        file,
      ) => [`protocol/apps/${file}`, `vendor/protocol/apps/${file}`]),
    ),
  },
  rewrite: {
    "../../protocol/apps/blueprint/mod.ts":
      "vendor/protocol/apps/blueprint/mod.ts",
    "../../protocol/apps/blueprint.ts": "vendor/protocol/apps/blueprint.ts",
  },
};

// @lophn/cap-store: migration 단계 type과 `-- loss:` 읽기는 protocol/apps/activation의 한 파일이다.
// 그 파일이 쓰는 Result는 base의 두 파일이고, 파일 위치가 사본 안에서도 같은 상대 경로로 닿는다.
const CAP_STORE: VendorRule = {
  files: {
    "protocol/apps/activation/migration.ts":
      "vendor/protocol/apps/activation/migration.ts",
    "base/errors.ts": "vendor/base/errors.ts",
    "base/result.ts": "vendor/base/result.ts",
  },
  rewrite: {
    "../../protocol/apps/activation/migration.ts":
      "vendor/protocol/apps/activation/migration.ts",
  },
  generated: {
    "vendor/base/mod.ts":
      'export type { LophnError } from "./errors.ts";\nexport { err, ok, type Result } from "./result.ts";\n',
  },
};

// @lophn/cap-problem: portable 보고 계약과 그 type이 쓰는 오류·Result type이다.
const CAP_PROBLEM: VendorRule = {
  files: {
    "protocol/problems/sdk-report.ts": "vendor/protocol/problems/sdk-report.ts",
    "base/errors.ts": "vendor/base/errors.ts",
    "base/result.ts": "vendor/base/result.ts",
  },
  rewrite: {
    "@lophn/protocol/problems/sdk-report":
      "vendor/protocol/problems/sdk-report.ts",
  },
  generated: {
    "vendor/base/mod.ts":
      'export type { LophnError } from "./errors.ts";\nexport type { Result } from "./result.ts";\n',
  },
};

export const VENDOR_RULES: Readonly<Record<string, VendorRule>> = {
  "@lophn/blueprint": BLUEPRINT,
  "@lophn/cap-problem": CAP_PROBLEM,
  "@lophn/cap-store": CAP_STORE,
};

// 설치 사본의 한 부분이면서 catalog Package가 아닌 지원 소스다. 공용 UI Package가 import하는
// `@lophn/design`·`@lophn/wording`·`@lophn/chart`가 여기다. catalog에 등록하지 않고 같은 sdk/<name>/<version>/
// 자리에 읽기 전용으로 풀어 앱 import map이 푼다.
export type SupportPackage = {
  name: string;
  version: string;
  // packages/ 기준 원본 폴더.
  source: string;
  // 사본에 넣지 않을 경로 구간(폴더 또는 파일 이름)과 파일 이름 접미.
  skipNames: readonly string[];
  skipSuffixes: readonly string[];
};

export const SUPPORT_VERSION = "1.0.0";

export const SUPPORT_PACKAGES: readonly SupportPackage[] = [
  {
    name: "@lophn/design",
    version: SUPPORT_VERSION,
    source: "design",
    // test·생성 도구·다른 Package(wording·chart)는 사본에 넣지 않는다.
    skipNames: ["testdata", "style-check", "wording", "chart"],
    skipSuffixes: ["_test.ts", "_test.tsx"],
  },
  {
    name: "@lophn/wording",
    version: SUPPORT_VERSION,
    source: "design/wording",
    // generate.ts는 앱 catalog의 placeholder 생성이 쓰므로 남긴다.
    skipNames: ["testdata"],
    skipSuffixes: ["_test.ts"],
  },
  {
    name: "@lophn/chart",
    version: SUPPORT_VERSION,
    source: "design/chart",
    skipNames: ["testdata"],
    skipSuffixes: ["_test.ts", "_test.tsx"],
  },
];

export function supportPackage(name: string): SupportPackage | undefined {
  return SUPPORT_PACKAGES.find((item) => item.name === name);
}

export function keepSupportFile(path: string, rule: SupportPackage): boolean {
  if (path.split("/").some((part) => rule.skipNames.includes(part))) {
    return false;
  }
  return !rule.skipSuffixes.some((suffix) => path.endsWith(suffix));
}

function posixDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

// `from`(사본 안 파일 경로)에서 `to`(사본 안 대상 경로)까지의 상대 specifier.
export function relativeSpecifier(from: string, to: string): string {
  const base = posixDirname(from).split("/").filter((part) => part !== "");
  const target = to.split("/");
  let shared = 0;
  while (
    shared < base.length && shared < target.length - 1 &&
    base[shared] === target[shared]
  ) shared += 1;
  const up = base.length - shared;
  const parts = [...Array(up).fill(".."), ...target.slice(shared)];
  const joined = parts.join("/");
  return up === 0 ? `./${joined}` : joined;
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs)$/;

// 사본 파일의 specifier를 규칙대로 바꾼다. 따옴표로 둘러싼 문자열 그대로만 바꾼다.
export function rewriteSpecifiers(
  file: SourceFile,
  rewrite: Readonly<Record<string, string>>,
): SourceFile {
  if (!SOURCE.test(file.path)) return file;
  const entries = Object.entries(rewrite);
  if (entries.length === 0) return file;
  let text = new TextDecoder().decode(file.bytes);
  let changed = false;
  for (const [from, target] of entries) {
    const next = relativeSpecifier(file.path, target);
    for (const quote of ['"', "'"]) {
      const needle = `${quote}${from}${quote}`;
      if (text.includes(needle)) {
        text = text.split(needle).join(`${quote}${next}${quote}`);
        changed = true;
      }
    }
  }
  return changed
    ? { path: file.path, bytes: new TextEncoder().encode(text) }
    : file;
}
