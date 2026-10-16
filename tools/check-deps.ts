// 실행: deno run --allow-read tools/check-deps.ts [root]
import { checkBlueprintGraph } from "./deps-blueprint.ts";
import { readImports } from "./deps-imports.ts";
import {
  directory,
  inside,
  normalize,
  readMembers,
  resolveWorkspace,
} from "./deps-workspace.ts";

export type Violation = {
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

async function walk(
  root: string,
): Promise<{ files: string[]; paths: string[] }> {
  const files: string[] = [];
  const paths: string[] = [];
  async function visit(parent: string) {
    for await (
      const entry of Deno.readDir(parent ? `${root}/${parent}` : root)
    ) {
      if (EXCLUDED.has(entry.name)) continue;
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      paths.push(path);
      if (entry.isDirectory) await visit(path);
      else if (entry.isFile) files.push(path);
    }
  }
  await visit("");
  return { files: files.sort(), paths: paths.sort() };
}

function numberedName(segment: string): boolean {
  const name = segment.replace(/\.[^.]+$/, "").replace(/_test$/, "");
  return /^(?:v\d+|[mw]\d+|milestone\d*|phase-?\d*)$/i.test(name) ||
    /^(?:new|old|legacy)-/i.test(name) || /-next$/i.test(name);
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
  "packages/protocol/lophn-agent/question-submission.ts",
  "packages/protocol/server/registration.ts",
]);

export async function checkRepo(root: string): Promise<Violation[]> {
  root = normalize(root.startsWith("/") ? root : `${Deno.cwd()}/${root}`);
  const { files, paths } = await walk(root);
  const members = await readMembers(root, files);
  const violations: Violation[] = [];
  const edges: Edge[] = [];
  const sources = new Map<string, string>();
  const add = (file: string, line: number, rule: string, message: string) =>
    violations.push({ file, line, rule, message });

  for (const path of paths) {
    if (!/^(packages|tools)\//.test(path)) continue;
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
      const text = await Deno.readTextFile(`${root}/${file}`);
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
    const source = await Deno.readTextFile(`${root}/${file}`);
    sources.set(file, source);
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
  checkBlueprintGraph(sources, add);
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
    const violations = await checkRepo(Deno.args[0] ?? Deno.cwd());
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`,
      );
    }
    if (!violations.length) console.log("deps: 통과");
    Deno.exit(violations.length ? 1 : 0);
  } catch (error) {
    console.error(
      `deps: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
