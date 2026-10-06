// 정확한 import map(apps/sdk#R33, R34, R7). 앱이 고르는 설치 SDK Package에서 시작해, 설치 사본의
// 소스가 import하는 `@lophn/*`와 npm 의존을 끝까지 따라가 정확한 version 하나씩만 담는다. 사본 안에서
// 풀리지 않는 import와 같은 이름의 다른 pin은 import map을 만들지 않고 실패한다. 실행 때 새 패키지를
// 내려받거나 다른 version으로 바꾸지 않는다(apps/sdk#R10).
import { err, ok, type Result } from "../../../base/mod.ts";
import { type SourceFile, SUPPORT_PACKAGES } from "../vendor.ts";

export type ImportMapFailure = { code: "invalid_input"; message: string };

export type PackageRef = { name: string; version: string };

export type ImportMap = { imports: Record<string, string> };

type Config = {
  exports: Record<string, string>;
  imports: Record<string, string>;
};

type Loaded = { files: SourceFile[]; config: Config };

function failure(message: string): Result<never, ImportMapFailure> {
  return err({ code: "invalid_input", message });
}

// `@lophn/ui-state` → `ui-state`. sdk/<이름>/<version>/ 폴더 이름이다.
export function installPart(name: string): string {
  return name.slice(name.indexOf("/") + 1);
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|[^:"'`])\/\/.*$/gm,
    "$1",
  );
}

// 줄 처음에서 시작하는 import·export ... from과 부수 효과 import, 동적 import만 읽는다. 문자열 안의
// 예시 문장은 읽지 않는다.
const STATEMENTS = [
  /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

export function importSpecifiers(text: string): string[] {
  const found = new Set<string>();
  const source = stripComments(text);
  for (const pattern of STATEMENTS) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function normalizeExports(
  value: unknown,
): Record<string, string> {
  if (typeof value === "string") return { ".": value };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter((
        [, target],
      ) => typeof target === "string") as [string, string][],
    );
  }
  return { ".": "./mod.ts" };
}

function parseConfig(files: readonly SourceFile[]): Config {
  const file = files.find((item) => item.path === "deno.json");
  if (file === undefined) return { exports: { ".": "./mod.ts" }, imports: {} };
  const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as {
    exports?: unknown;
    imports?: Record<string, string>;
  };
  return {
    exports: normalizeExports(parsed.exports),
    imports: parsed.imports ?? {},
  };
}

async function readCopy(
  directory: string,
): Promise<SourceFile[] | undefined> {
  const files: SourceFile[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(`${dir}/${entry.name}`, path);
      else if (entry.isFile) {
        files.push({
          path,
          bytes: await Deno.readFile(`${dir}/${entry.name}`),
        });
      }
    }
  }
  try {
    await visit(directory, "");
  } catch {
    return undefined;
  }
  return files;
}

function splitSpecifier(
  specifier: string,
): { base: string; subpath: string } {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  const base = parts.slice(0, size).join("/");
  const rest = parts.slice(size).join("/");
  return { base, subpath: rest === "" ? "." : `./${rest}` };
}

// 사본 안 상대 specifier가 가리키는 사본 경로. 사본 밖으로 나가면 undefined다.
function resolveRelative(from: string, specifier: string): string | undefined {
  const stack = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (stack.length === 0) return undefined;
      stack.pop();
    } else stack.push(part);
  }
  return stack.join("/");
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs)$/;

// 공개한 export에서 상대 import를 따라 닿는 소스만 읽는다. 시험·예제·내보내지 않는 도우미는 앱이
// 불러오지 않는다. 사본 밖으로 나가거나 사본에 없는 상대 import는 실패다.
function scanReachable(
  copy: Loaded,
  label: string,
): Result<{ file: string; specifier: string }[], ImportMapFailure> {
  const texts = new Map(copy.files.map((file) => [file.path, file.bytes]));
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const target of Object.values(copy.config.exports)) {
    const path = resolveRelative("mod.ts", target);
    if (path === undefined || !texts.has(path)) {
      return failure(
        `${label} exports ${target}, which is not in the install copy`,
      );
    }
    queue.push(path);
  }
  const found: { file: string; specifier: string }[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    if (seen.has(path)) continue;
    seen.add(path);
    if (!SOURCE.test(path)) continue;
    const specifiers = importSpecifiers(
      new TextDecoder().decode(texts.get(path)!),
    );
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) {
        found.push({ file: path, specifier });
        continue;
      }
      const target = resolveRelative(path, specifier);
      if (target === undefined || !texts.has(target)) {
        return failure(
          `${label} ${path} imports ${specifier}, which ${
            target === undefined ? "leaves" : "is not in"
          } the install copy`,
        );
      }
      queue.push(target);
    }
  }
  return ok(found);
}

function npmFor(
  specifier: string,
  pins: ReadonlyMap<string, string>,
): string | undefined {
  const exact = pins.get(specifier);
  if (exact !== undefined) return exact;
  const { base, subpath } = splitSpecifier(specifier);
  const pin = pins.get(base);
  if (pin === undefined || !pin.startsWith("npm:") || subpath === ".") {
    return undefined;
  }
  return `${pin}/${subpath.slice(2)}`;
}

export type ImportMapInput = {
  // 설치 SDK 폴더. sdk/<이름>/<version>/ 사본이 이 아래에 있다.
  sdkRoot: string;
  // 앱이 직접 고르는 Package. 설치 사본 import를 따라 필요한 Package는 자동으로 더한다.
  roots: readonly PackageRef[];
  // 사본이 import하지 않아도 앱 화면이 직접 쓰는 npm 이름(예: react-dom/client).
  extra?: readonly string[];
  // roots에 없는 Package의 version. 지원 소스(design·wording)의 version은 기본으로 안다.
  versions?: Readonly<Record<string, string>>;
};

export type ImportMapResult = {
  map: ImportMap;
  // 따라간 Package 전체(roots와 사본 import로 더해진 것).
  packages: PackageRef[];
};

// 설치 사본에서 정확한 import map을 만든다. `lophn-sdk:<name>@<version>/<경로>`와 정확한 `npm:` pin만
// 담고 ^·~·latest는 만들지 않는다(apps/sdk#R7).
export async function buildImportMap(
  input: ImportMapInput,
): Promise<Result<ImportMapResult, ImportMapFailure>> {
  const loaded = new Map<string, { version: string; copy: Loaded }>();
  const order: string[] = [];
  const queue: PackageRef[] = [...input.roots];
  const versions: Record<string, string> = {
    ...Object.fromEntries(
      SUPPORT_PACKAGES.map((item) => [item.name, item.version]),
    ),
    ...input.versions,
  };
  const npmPins = new Map<string, string>();
  const needed = new Map<string, string>(
    (input.extra ?? []).map((item) => [item, "the app"]),
  );
  // `@lophn/*` import가 가리키는 사본 경로. 모든 사본을 읽은 뒤 내보내는지 본다.
  const lophnUses = new Set<string>();

  async function load(
    ref: PackageRef,
  ): Promise<Result<void, ImportMapFailure>> {
    const known = loaded.get(ref.name);
    if (known !== undefined) {
      return known.version === ref.version
        ? ok(undefined)
        : failure(`${ref.name} is pinned to two versions`);
    }
    const files = await readCopy(
      `${input.sdkRoot}/${installPart(ref.name)}/${ref.version}`,
    );
    if (files === undefined) {
      return failure(`${ref.name}@${ref.version} is not installed`);
    }
    const config = parseConfig(files);
    // 지원 소스는 시험용 export(예: design의 component-tests)를 사본에 담지 않는다. 그 export는 map에 없다.
    if (SUPPORT_PACKAGES.some((item) => item.name === ref.name)) {
      const present = new Set(files.map((file) => file.path));
      config.exports = Object.fromEntries(
        Object.entries(config.exports).filter(([, target]) =>
          present.has(resolveRelative("mod.ts", target) ?? "")
        ),
      );
    }
    loaded.set(ref.name, { version: ref.version, copy: { files, config } });
    order.push(ref.name);
    return ok(undefined);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const ref = queue[index];
    const first = await load(ref);
    if (!first.ok) return first;
    const copy = loaded.get(ref.name)!.copy;
    for (const [key, value] of Object.entries(copy.config.imports)) {
      const known = npmPins.get(key);
      if (known !== undefined && known !== value) {
        return failure(`${key} has two pins: ${known} and ${value}`);
      }
      npmPins.set(key, value);
    }
    const label = `${ref.name}@${ref.version}`;
    const scanned = scanReachable(copy, label);
    if (!scanned.ok) return scanned;
    for (const { file, specifier } of scanned.value) {
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith("@lophn/")) {
        const { base } = splitSpecifier(specifier);
        if (base === ref.name) continue;
        const version = versions[base] ??
          queue.find((item) => item.name === base)?.version;
        if (version === undefined) {
          return failure(
            `${label} ${file} imports ${specifier}, which has no pinned version`,
          );
        }
        if (!queue.some((item) => item.name === base)) {
          queue.push({ name: base, version });
        }
        lophnUses.add(specifier);
      } else if (!needed.has(specifier)) {
        needed.set(specifier, `${label} ${file}`);
      }
    }
  }

  const imports: Record<string, string> = {};
  for (const name of order) {
    const { version, copy } = loaded.get(name)!;
    for (const [key, target] of Object.entries(copy.config.exports)) {
      const specifier = key === "." ? name : `${name}/${key.slice(2)}`;
      imports[specifier] = `lophn-sdk:${name}@${version}/${target.slice(2)}`;
    }
  }
  for (const specifier of lophnUses) {
    if (imports[specifier] === undefined) {
      return failure(`${specifier} is not exported by its install copy`);
    }
  }
  for (const [item, origin] of needed) {
    const pin = npmFor(item, npmPins);
    if (pin === undefined) {
      return failure(
        `${item} (imported by ${origin}) has no exact pin in the installed packages`,
      );
    }
    imports[item] = pin;
  }
  const sorted = Object.fromEntries(
    Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return ok({
    map: { imports: sorted },
    packages: order.map((name) => ({
      name,
      version: loaded.get(name)!.version,
    })),
  });
}

// 앱 deno.json의 `lophn-sdk:` 값을 설치 사본의 file URL로 바꾼 개발용 import map이다. 상대 경로 값은
// 앱 폴더 기준 file URL로 바꾼다(map 파일은 `.lophn/`에 있다). 이 map은 이 장치의 설치 위치를 담으므로
// 앱 source에 넣지 않는다.
export function devImportMap(
  imports: Readonly<Record<string, string>>,
  sdkRoot: string,
  appDir: string,
): ImportMap {
  const sdkBase = `file://${sdkRoot.replace(/\/?$/, "/")}`;
  const appBase = `file://${appDir.replace(/\/?$/, "/")}`;
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    const match = /^lophn-sdk:(@[^/]+\/[^@]+)@([^@/]+)\/(.+)$/.exec(value);
    mapped[key] = match
      ? new URL(
        `${installPart(match[1])}/${match[2]}/${match[3]}`,
        sdkBase,
      ).href
      : value.startsWith("./") || value.startsWith("../")
      ? new URL(value, appBase).href
      : value;
  }
  return { imports: mapped };
}
