// 실행: deno run --allow-read tools/check-deps.ts [root]
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";

import { checkDeclarationGraph } from "./deps-declaration.ts";
import { readImports, readStringSites } from "./deps-imports.ts";
import {
  directory,
  inside,
  normalize,
  readMembers,
  resolveWorkspace,
} from "./deps-workspace.ts";

type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
};
const EXCLUDED = new Set(["node_modules", ".claude", ".dev-data", "dist"]);

// package가 import해도 되는 다른 package. 자기 package 안은 늘 된다.
export const PACKAGE_DEPENDENCIES: Record<string, string[]> = {
  base: [],
  protocol: ["base"],
  core: ["protocol", "base"],
  "coding-agent": ["protocol", "base"],
  design: [],
  sdk: ["protocol", "design"],
  shell: ["protocol", "base", "design"],
};
// shell main의 terminal host만 coding-agent를 더 쓸 수 있다.
const TERMINAL_HOST = [
  "packages/shell/terminal-host",
  "packages/shell/main/terminal",
];

export async function walk(
  root: string,
): Promise<{ files: string[]; paths: string[] }> {
  const files: string[] = [];
  const paths: string[] = [];
  async function visit(parent: string) {
    for (
      const entry of await readdir(parent ? `${root}/${parent}` : root, {
        withFileTypes: true,
      })
    ) {
      if (EXCLUDED.has(entry.name)) continue;
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      paths.push(path);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit("");
  return { files: files.sort(), paths: paths.sort() };
}

function numberedName(segment: string): boolean {
  const name = segment.replace(/\.[^.]+$/, "").replace(/_test$/, "");
  return name.split(/[-.]/).some((token) =>
    /^(?:v\d+|[mw]\d+|milestone\d*)$/i.test(token)
  ) || /^phase-?\d*$/i.test(name) || /^(?:new|old|legacy)-/i.test(name) ||
    /-next$/i.test(name);
}

// core 안 층. 바닥(그 밖 전부) < harness(lophn-agent) < role 층(agent-roles)·feature module(projects, apps, domains, runs) < main(조립).
// harness와 바닥은 role 층과 feature module을 모르고, role 층과 feature module은 서로 모른다. 둘 다 harness는 쓸 수 있다.
// feature module끼리는 서로 import하지 않는다(project-docs/architecture/layers.md).
const CORE_HARNESS = "lophn-agent";
const CORE_ROLES = "agent-roles";
const CORE_FEATURES = new Set([
  "projects",
  "apps",
  "domains",
  "runs",
  "workflows",
  "jobs",
]);
function coreModule(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === "packages" && parts[1] === "core" && parts.length > 3
    ? parts[2]
    : undefined;
}
function coreLayerViolation(file: string, target: string): string | undefined {
  const from = coreModule(file);
  const to = coreModule(target);
  if (!from || !to || from === to) return;
  if (from !== "main" && to === "main") {
    return `module은 core/main을 import하지 않는다: ${from} → main`;
  }
  const upper = (name: string) =>
    name === CORE_HARNESS || name === CORE_ROLES || CORE_FEATURES.has(name);
  if (from !== "main" && !upper(from) && upper(to)) {
    return `바닥은 ${CORE_HARNESS}, ${CORE_ROLES}, feature module을 import하지 않는다: ${from} → ${to}`;
  }
  if (from === CORE_HARNESS && (to === CORE_ROLES || CORE_FEATURES.has(to))) {
    return `${CORE_HARNESS}는 ${CORE_ROLES}와 feature module을 import하지 않는다: ${from} → ${to}`;
  }
  if (
    (from === CORE_ROLES && CORE_FEATURES.has(to)) ||
    (CORE_FEATURES.has(from) && to === CORE_ROLES)
  ) {
    return `feature module과 ${CORE_ROLES}는 서로 import하지 않는다: ${from} → ${to}`;
  }
  if (CORE_FEATURES.has(from) && CORE_FEATURES.has(to)) {
    return `feature module끼리는 서로 import하지 않는다: ${from} → ${to}`;
  }
}

// harness 폴더가 feature module의 protocol과 role 이름을 아는 것(rule harness-domain). 앞 task가 못 끊은 file은 이유와 함께 면제한다.
// 목록 file이 위반을 다 없애면 검사가 빼라고 알려준다.
const HARNESS_DIR = `packages/core/${CORE_HARNESS}/`;
const HARNESS_FEATURE_PROTOCOLS = [
  "apps",
  "problems",
  "projects",
  "coding-agent",
];
const ROLE_NAMES = new Set(["project_manager", "app_engineer", "operator"]);
const HARNESS_LEFTOVERS: ReadonlyMap<string, string> = new Map([
  [
    "packages/core/lophn-agent/run-loop/runtime-access.ts",
    "못 옮김: agent runtime이 열 core route 목록이 apps protocol의 route 값을 직접 import한다",
  ],
  [
    "packages/core/lophn-agent/tools/file/outline.ts",
    "못 옮김: file.outline이 projects protocol의 parseOutline으로 md 제목 tree를 만든다",
  ],
  [
    "packages/core/lophn-agent/tools/app-tool/input.ts",
    "못 옮김: 동적 tool이 apps protocol의 입력 type을 쓴다(feature module의 tool로 옮기지 않았다)",
  ],
  [
    "packages/core/lophn-agent/tools/app-toolkit.ts",
    "못 옮김: 동적 tool 묶음이 apps protocol의 appTools를 읽는다",
  ],
  [
    "packages/core/lophn-agent/tools/app-tools.ts",
    "못 옮김: 동적 tool이 apps protocol의 app runtime·AppTools를 쓴다",
  ],
  [
    "packages/core/lophn-agent/tools/file/image.ts",
    "못 옮김: file.image가 apps protocol의 annotationsGet으로 annotation 이미지를 읽는다",
  ],
  [
    "packages/core/lophn-agent/tools/file/read.ts",
    "못 옮김: file.read가 projects protocol의 openableKind로 열 수 있는 형식을 고른다",
  ],
]);

// tool 정의 file은 agent runtime child에서 실려서 store·DB 코드를 끌어오면 안 된다(rule tool-file).
const FEATURE_TOOL_PLACES = [
  "packages/core/apps/agent-tools/",
  "packages/core/domains/agent-tools.ts",
  "packages/core/workflows/agent-tools.ts",
  "packages/core/jobs/agent-tools.ts",
];
const ROLE_TOOL_DIR = `packages/core/${CORE_ROLES}/tools/`;
const SPI = `packages/core/${CORE_HARNESS}/tools/spi.ts`;
function toolFileViolation(
  file: string,
  specifier: string,
  target: string | undefined,
): string | undefined {
  const place = FEATURE_TOOL_PLACES.find((path) => file.startsWith(path));
  const role = file.startsWith(ROLE_TOOL_DIR);
  if (!place && !role) return;
  if (specifier === "node:sqlite") return "node:sqlite를 import하지 않는다";
  if (!target) return;
  if (target.startsWith("packages/core/storage/")) {
    return `storage를 import하지 않는다: ${specifier}`;
  }
  if (role) {
    return target.startsWith(`packages/core/${CORE_ROLES}/`) &&
        /\/(?:store|ledger|register)(?:[-./]|$)/.test(target)
      ? `store·ledger·register를 import하지 않는다: ${specifier}`
      : undefined;
  }
  const ok = target === SPI || target.startsWith("packages/base/") ||
    target.startsWith("packages/protocol/") || target.startsWith(place!);
  return ok
    ? undefined
    : `feature module의 tool 정의 file은 base, protocol, 같은 폴더, ${CORE_HARNESS}/tools/spi.ts만 import: ${specifier}`;
}

function harnessProtocol(file: string, target: string): string | undefined {
  if (!file.startsWith(HARNESS_DIR)) return;
  const top = HARNESS_FEATURE_PROTOCOLS.find((name) =>
    target.startsWith(`packages/protocol/${name}/`)
  );
  return top && `protocol/${top} import`;
}

function protocolTop(file: string): string | undefined {
  if (!file.startsWith("packages/protocol/")) return;
  const parts = file.split("/");
  return parts.length > 3 ? parts[2] : undefined;
}

type Edge = { from: string; to: string; file: string; line: number };
function cyclicEdges(edges: Edge[]): Edge[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!graph.has(edge.from)) graph.set(edge.from, new Set());
    graph.get(edge.from)!.add(edge.to);
  }
  function reaches(
    from: string,
    goal: string,
    seen = new Set<string>(),
  ): boolean {
    if (from === goal) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(graph.get(from) ?? [])].some((to) => reaches(to, goal, seen));
  }
  return edges.filter((edge) => reaches(edge.to, edge.from));
}

// 새 계약으로 바뀌어 곧 지울 옛 file이다. 이 file의 import는 protocol 순환에 세지 않는다.
// 쓰는 곳을 걷고 file을 지우면 여기서도 뺀다. cleanup 때 이 목록은 비어야 한다.
const LEAVING_FILES = new Set([
  "packages/protocol/server/registration.ts",
]);

async function checkRepo(root: string): Promise<Violation[]> {
  root = normalize(root.startsWith("/") ? root : `${process.cwd()}/${root}`);
  const { files, paths } = await walk(root);
  const members = await readMembers(root, files);
  const violations: Violation[] = [];
  const edges: Edge[] = [];
  const sources = new Map<string, string>();
  const harnessHits = new Set<string>();
  const add = (file: string, line: number, rule: string, message: string) =>
    violations.push({ file, line, rule, message });
  const harness = (file: string, line: number, what: string) => {
    harnessHits.add(file);
    if (!HARNESS_LEFTOVERS.has(file)) {
      add(
        file,
        line,
        "harness-domain",
        `${CORE_HARNESS}는 feature module의 protocol과 role 이름을 모른다: ${what}`,
      );
    }
  };

  for (const path of paths) {
    if (!/^(packages|tools)\//.test(path)) continue;
    // 내장 skill 폴더 이름은 사람이 `/`로 치는 이름(`new-app`)이라 판 이름이 아니다.
    if (path.startsWith("packages/core/agent-roles/skills/")) continue;
    const segment = path.slice(path.lastIndexOf("/") + 1);
    if (numberedName(segment)) {
      add(path, 1, "name", `판·단계·작업 번호 이름 금지: ${segment}`);
    }
  }
  for (const file of files) {
    const own = file.split("/")[0] === "packages"
      ? file.split("/")[1]
      : undefined;
    const portable = own === "base" || own === "protocol";
    if (portable && file.endsWith("/deno.json")) {
      const text = await readFile(`${root}/${file}`, "utf8");
      const config = JSON.parse(text);
      if (config.compilerOptions?.erasableSyntaxOnly !== true) {
        const offset = text.search(/"(?:compilerOptions|erasableSyntaxOnly)"/);
        const line = offset < 0 ? 1 : text.slice(0, offset).split("\n").length;
        add(
          file,
          line,
          "portable-config",
          "compilerOptions.erasableSyntaxOnly: true 필요",
        );
      }
    }
    if (!/\.tsx?$/.test(file)) continue;
    const test = file.endsWith("_test.ts");
    // test 코드는 package 규칙에서 뺀다. 여러 package를 같이 띄우는 통합 test가 있어서다.
    // core를 import하는 것만은 test도 core 안에서만 한다.
    const testCode = /_test\.tsx?$/.test(file) ||
      /\/(?:testing|testdata)\//.test(file);
    const source = await readFile(`${root}/${file}`, "utf8");
    sources.set(file, source);
    if (!testCode && file.startsWith(HARNESS_DIR)) {
      for (const { specifier, line } of readStringSites(source)) {
        if (ROLE_NAMES.has(specifier)) {
          harness(file, line, `role 이름 문자열 "${specifier}"`);
        }
      }
    }
    for (const { specifier, line } of readImports(source)) {
      const relative = specifier.startsWith("./") ||
        specifier.startsWith("../");
      const absoluteTarget = relative
        ? normalize(`${root}/${directory(file)}/${specifier}`)
        : undefined;
      const target = absoluteTarget
        ? inside(absoluteTarget, root)
          ? absoluteTarget.slice(root.length + 1)
          : undefined
        : specifier.startsWith("@lophn/")
        ? resolveWorkspace(specifier, members)
        : undefined;
      if (specifier.startsWith("@lophn/") && !target) {
        add(
          file,
          line,
          "workspace",
          `workspace exports로 해석할 수 없음: ${specifier}`,
        );
      }
      if (portable && /^(?:npm:|jsr:|node:|https?:)/.test(specifier)) {
        add(
          file,
          line,
          "portable-import",
          `이식할 수 없는 specifier: ${specifier}`,
        );
      }
      // base와 protocol이 repo 밖에서 가져오는 것은 protocol의 zod와 test의 @std/assert뿐이다.
      if (
        portable && !relative && !specifier.startsWith("@lophn/") &&
        !(test && specifier === "@std/assert") &&
        !(own === "protocol" && specifier === "zod")
      ) {
        add(
          file,
          line,
          "external",
          `${own}는 허용된 외부 specifier만 import: ${specifier}`,
        );
      }
      const from = protocolTop(file);
      const to = target ? protocolTop(target) : undefined;
      // 순환은 제품 코드의 import로만 센다. test가 두 module을 같이 쓰는 것은 실행 순환이 아니다.
      if (from && to && from !== to && !testCode && !LEAVING_FILES.has(file)) {
        edges.push({ from, to, file, line });
      }
      const targetPackage = target?.startsWith("packages/")
        ? target.split("/")[1]
        : undefined;
      if (
        !(testCode && targetPackage !== "core") && own &&
        own in PACKAGE_DEPENDENCIES && targetPackage &&
        targetPackage !== own &&
        !PACKAGE_DEPENDENCIES[own].includes(targetPackage) &&
        !(targetPackage === "coding-agent" && own === "shell" &&
          TERMINAL_HOST.some((place) => inside(file, place)))
      ) {
        add(
          file,
          line,
          "package",
          targetPackage === "core"
            ? `core를 import하는 것은 core뿐: ${specifier}`
            : `package 의존 금지 ${own} → ${targetPackage}: ${specifier}`,
        );
      }
      if (!testCode && target) {
        const message = coreLayerViolation(file, target);
        if (message) add(file, line, "core-layer", message);
        const protocol = harnessProtocol(file, target);
        if (protocol) harness(file, line, protocol);
      }
      if (!testCode) {
        const tool = toolFileViolation(file, specifier, target);
        if (tool) add(file, line, "tool-file", tool);
      }
      // testing/ 안은 *_test.ts와 같은 testing/ 안 파일만 import한다(제품 module graph에 test 도구가 들어가지 않게).
      const testing = target &&
        /^packages\/[^/]+\/(?:.+\/)?testing\//.exec(target)?.[0];
      if (testing && !test && !inside(file, testing.slice(0, -1))) {
        add(
          file,
          line,
          "testing",
          `testing/은 *_test.ts와 testing/ 안에서만 import: ${specifier}`,
        );
      }
    }
  }
  for (const [file, reason] of HARNESS_LEFTOVERS) {
    if (files.includes(file) && !harnessHits.has(file)) {
      add(
        file,
        1,
        "harness-domain",
        `위반이 없다. HARNESS_LEFTOVERS에서 뺀다 (${reason})`,
      );
    }
  }
  checkDeclarationGraph(sources, add);
  for (const edge of cyclicEdges(edges)) {
    add(
      edge.file,
      edge.line,
      "protocol-cycle",
      `protocol 최상위 사이 순환: ${edge.from} → ${edge.to}`,
    );
  }
  return violations.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.rule.localeCompare(b.rule)
  );
}

if (import.meta.main) {
  try {
    const violations = await checkRepo(process.argv[2] ?? process.cwd());
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`,
      );
    }
    if (!violations.length) console.log("deps: 통과");
    process.exit(violations.length ? 1 : 0);
  } catch (error) {
    console.error(
      `deps: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
