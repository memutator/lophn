import { readFile } from "node:fs/promises";

import { err, ok, type Result } from "../../../base/mod.ts";

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
  // vendor/로 담아 사본이 더는 기대지 않는 package. 사본 package.json의 dependencies에서 뺀다.
  vendored?: readonly string[];
};

// @lophn/declaration: 정본 검증기는 protocol/apps/declaration의 의존성 없는 파일들이다(read.ts·check.ts는 zod를 써서 뺀다).
const DECLARATION: VendorRule = {
  files: Object.fromEntries(
    [
      "mod.ts",
      "types.ts",
      "json.ts",
      "schema.ts",
      "scope.ts",
      "uses.ts",
      "tools.ts",
      "value.ts",
    ].map((file) => [
      `protocol/apps/declaration/${file}`,
      `vendor/protocol/apps/declaration/${file}`,
    ]),
  ),
  rewrite: {
    "../../protocol/apps/declaration/mod.ts":
      "vendor/protocol/apps/declaration/mod.ts",
  },
};

// @lophn/cap-store: migration 단계 type과 `-- loss:` 읽기는 protocol/apps/activation의 zod 없는 한 파일이다.
// 그 파일이 쓰는 Result는 base의 두 파일이고, 파일 위치가 사본 안에서도 같은 상대 경로로 닿는다.
const CAP_STORE: VendorRule = {
  files: {
    "protocol/apps/activation/migration-sql.ts":
      "vendor/protocol/apps/activation/migration-sql.ts",
    "base/errors.ts": "vendor/base/errors.ts",
    "base/result.ts": "vendor/base/result.ts",
  },
  rewrite: {
    "../../protocol/apps/activation/migration-sql.ts":
      "vendor/protocol/apps/activation/migration-sql.ts",
  },
  generated: {
    "vendor/base/mod.ts":
      'export type { LophnError } from "./errors.ts";\nexport { err, ok, type Result } from "./result.ts";\n',
  },
};

// @lophn/cap-problem: portable 예외 관측 계약과 `reportProblem` type, 그 type이 쓰는 오류·Result type이다.
const CAP_PROBLEM: VendorRule = {
  files: {
    "protocol/problems/sdk-report.ts": "vendor/protocol/problems/sdk-report.ts",
    "protocol/problems/sdk-problem.ts":
      "vendor/protocol/problems/sdk-problem.ts",
    "base/errors.ts": "vendor/base/errors.ts",
    "base/result.ts": "vendor/base/result.ts",
  },
  rewrite: {
    "@lophn/protocol/problems/sdk-report":
      "vendor/protocol/problems/sdk-report.ts",
    "@lophn/protocol/problems/sdk-problem":
      "vendor/protocol/problems/sdk-problem.ts",
  },
  generated: {
    "vendor/base/mod.ts":
      'export type { LophnError } from "./errors.ts";\nexport type { Result } from "./result.ts";\n',
  },
  vendored: ["@lophn/protocol"],
};

// @lophn/agent: ACP 갱신을 접는 reduce.ts는 runtime에 의존이 없다. 그 type import(items.ts·state.ts)는 zod 정본으로 닿으므로
// 사본 안 얇은 re-export로 사본의 zod 없는 type(acp-types.ts)에 잇는다. 정본과 같은지는 agent_test.ts가 본다.
const AGENT: VendorRule = {
  files: {
    "protocol/acp/reduce.ts": "vendor/protocol/acp/reduce.ts",
  },
  rewrite: {
    "../../protocol/acp/reduce.ts": "vendor/protocol/acp/reduce.ts",
  },
  generated: {
    "vendor/protocol/acp/items.ts":
      'export type { AcpItem, AcpMessageItem, AcpToolItem } from "../../../acp-types.ts";\n',
    "vendor/protocol/acp/state.ts":
      'export type { AcpState, AcpTurn, AcpUpdate } from "../../../acp-types.ts";\n',
  },
};

const VENDOR_RULES: Readonly<Record<string, VendorRule>> = {
  "@lophn/agent": AGENT,
  "@lophn/declaration": DECLARATION,
  "@lophn/cap-problem": CAP_PROBLEM,
  "@lophn/cap-store": CAP_STORE,
};

// catalog에 올리지 않는 지원 소스. 공용 UI package가 import하는 `@lophn/ui`·`@lophn/i18n`이고
// 이름·판은 source 폴더의 package.json에서 읽는다. skip은 사본에 넣지 않을 경로 구간이다.
export const SUPPORT_SOURCES: readonly { source: string; skip: string[] }[] = [
  // i18n은 별도 package이고 style-check는 repo 검사 도구다.
  { source: "design", skip: ["i18n", "style-check"] },
  { source: "design/i18n", skip: [] },
];

// 사본에 test와 testdata는 들 이유가 없다. 폴더 경로는 끝에 `/`가 붙어 들어온다.
// package.json은 사본에 넣는다. npm이 사본을 package로 읽고 그 안의 의존을 풀어야 한다.
export function keepSourceFile(path: string, skip: readonly string[]): boolean {
  if (
    path.split("/").some((part) => part === "testdata" || skip.includes(part))
  ) {
    return false;
  }
  return !/_test\.tsx?$/.test(path);
}

function posixDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

// `from`(사본 안 파일 경로)에서 `to`(사본 안 대상 경로)까지의 상대 specifier.
function relativeSpecifier(from: string, to: string): string {
  const base = posixDirname(from)
    .split("/")
    .filter((part) => part !== "");
  const target = to.split("/");
  let shared = 0;
  while (
    shared < base.length &&
    shared < target.length - 1 &&
    base[shared] === target[shared]
  )
    shared += 1;
  const up = base.length - shared;
  const parts = [...Array(up).fill(".."), ...target.slice(shared)];
  const joined = parts.join("/");
  return up === 0 ? `./${joined}` : joined;
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs)$/;

// 사본 파일의 specifier를 규칙대로 바꾼다. 따옴표로 둘러싼 문자열 그대로만 바꾼다.
function rewriteSpecifiers(
  file: SourceFile,
  rewrite: Readonly<Record<string, string>>,
): SourceFile {
  if (!SOURCE.test(file.path)) return file;
  let text = new TextDecoder().decode(file.bytes);
  let changed = false;
  for (const [from, target] of Object.entries(rewrite)) {
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

function dropDependencies(
  file: SourceFile,
  names: readonly string[],
): SourceFile {
  if (names.length === 0) return file;
  const manifest = JSON.parse(new TextDecoder().decode(file.bytes)) as {
    dependencies?: Record<string, string>;
  };
  if (manifest.dependencies === undefined) return file;
  for (const name of names) delete manifest.dependencies[name];
  if (Object.keys(manifest.dependencies).length === 0) {
    delete manifest.dependencies;
  }
  return {
    path: file.path,
    bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  };
}

// 규칙이 있는 package의 사본에 밖의 소스를 vendor/로 더하고 specifier를 바꾼다. 정렬은 부른 쪽이 한다.
export async function vendorFiles(
  name: string,
  files: readonly SourceFile[],
  packagesRoot: string,
): Promise<Result<SourceFile[]>> {
  const rule = VENDOR_RULES[name];
  if (rule === undefined) return ok([...files]);
  const out = files.map((file) =>
    file.path === "package.json"
      ? dropDependencies(file, rule.vendored ?? [])
      : rewriteSpecifiers(file, rule.rewrite),
  );
  for (const [from, to] of Object.entries(rule.files)) {
    try {
      out.push({
        path: to,
        bytes: await readFile(`${packagesRoot}/${from}`),
      });
    } catch {
      return err({
        code: "invalid_input",
        message: `vendored source is missing: ${from}`,
      });
    }
  }
  for (const [path, text] of Object.entries(rule.generated ?? {})) {
    out.push({ path, bytes: new TextEncoder().encode(text) });
  }
  return ok(out);
}
