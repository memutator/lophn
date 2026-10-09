// 실행: deno run --allow-read tools/check-deps.ts [root]
import { blueprintEntryImport, checkBlueprintGraph } from "./deps-blueprint.ts";
import { readImports } from "./deps-imports.ts";
import {
  directory,
  inside,
  type Member,
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
const TOPS = new Set([
  "platform",
  "documents",
  "apps",
  "problems",
  "lophn-agent",
  "coding-agent",
]);

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

function leaf(
  file: string,
  members: Member[],
  files: Set<string>,
): string | undefined {
  const [packages, top, first] = file.split("/");
  if (
    packages !== "packages" || !TOPS.has(top) || !first ||
    !file.includes("/", `packages/${top}/`.length)
  ) return;
  const member =
    members.filter((member) =>
      member.directory.startsWith(`packages/${top}/`) &&
      inside(file, member.directory)
    ).sort((a, b) => b.directory.length - a.directory.length)[0];
  if (member) return member.directory;
  // workspace member가 최상위 package이면 mod.ts가 leaf의 경계를 정한다.
  let parent = directory(file);
  let boundary: string | undefined;
  while (parent.startsWith(`packages/${top}/`)) {
    if (files.has(`${parent}/mod.ts`)) boundary = parent;
    parent = directory(parent);
  }
  return boundary ?? `packages/${top}/${first}`;
}

function contractTop(file: string): string | undefined {
  if (!file.startsWith("packages/contracts/")) return;
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

export async function checkRepo(root: string): Promise<Violation[]> {
  root = normalize(root.startsWith("/") ? root : `${Deno.cwd()}/${root}`);
  const { files, paths } = await walk(root);
  const allFiles = new Set(files);
  const members = await readMembers(root, files);
  const violations: Violation[] = [];
  const edges: Edge[] = [];
  const sources = new Map<string, string>();
  const add = (file: string, line: number, rule: string, message: string) =>
    violations.push({ file, line, rule, message });

  for (const path of paths) {
    if (!/^(packages|apps|tools|e2e)\//.test(path)) continue;
    const segment = path.slice(path.lastIndexOf("/") + 1);
    // docs/flows/new-app.md 흐름 이름. new- 판 접두가 아니다.
    if (
      numberedName(segment) && path !== "e2e/coding-agent/new-app_test.ts"
    ) {
      add(path, 1, "name", `판·단계·작업 번호 이름 금지: ${segment}`);
    }
  }
  for (const file of files) {
    const base = inside(file, "packages/base");
    const contracts = inside(file, "packages/contracts");
    if ((base || contracts) && file.endsWith("/deno.json")) {
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
    const sourceLeaf = leaf(file, members, allFiles);
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
      const stdAssert = test && specifier === "@std/assert";
      if (specifier.startsWith("@lophn/") && !target) {
        add(
          file,
          line,
          "workspace",
          `workspace exports로 해석할 수 없음: ${specifier}`,
        );
      }
      if (
        (base || contracts) && /^(?:npm:|jsr:|node:|https?:)/.test(specifier)
      ) {
        add(
          file,
          line,
          "portable-import",
          `이식할 수 없는 specifier: ${specifier}`,
        );
      }
      if (
        base && !(relative && target && inside(target, "packages/base")) &&
        !stdAssert
      ) {
        add(
          file,
          line,
          "base",
          `base는 자기 안 상대 경로만 import: ${specifier}`,
        );
      }
      if (contracts && !stdAssert && specifier !== "zod") {
        const allowed = target && (
          (relative && inside(target, "packages/contracts")) ||
          ((relative || specifier === "@lophn/base") &&
            inside(target, "packages/base"))
        );
        if (!allowed) {
          add(
            file,
            line,
            "contracts",
            `contracts는 contracts·base·zod만 import: ${specifier}`,
          );
        }
      }
      const from = contractTop(file);
      const to = target ? contractTop(target) : undefined;
      if (from && to && from !== to) edges.push({ from, to, file, line });
      if (sourceLeaf && target?.startsWith("packages/")) {
        const top = file.split("/")[1];
        const targetTop = target.split("/")[1];
        if (targetTop === "contracts") {
          if (
            !/^packages\/contracts\/[^/]+\/mod\.ts$/.test(target) &&
            // *_test.ts는 다른 leaf의 contract testing/mod.ts(fixture)도 import할 수 있다.
            !(test &&
              /^packages\/contracts\/[^/]+\/testing\/mod\.ts$/.test(target)) &&
            !blueprintEntryImport(file, target)
          ) {
            add(
              file,
              line,
              "leaf-contract",
              `다른 최상위 contract는 mod.ts로 import: ${specifier}`,
            );
          }
        } else if (targetTop !== "base") {
          if (targetTop !== top) {
            add(
              file,
              line,
              "top-level",
              `다른 최상위 package 직접 import 금지: ${specifier}`,
            );
          } else {
            const targetLeaf = leaf(target, members, allFiles);
            // *_test.ts는 다른 leaf의 testing/mod.ts(테스트 전용 fixture)도 import할 수 있다.
            const fixture = test && targetLeaf !== undefined &&
              target === `${targetLeaf}/testing/mod.ts`;
            const extractFile = file ===
                "packages/apps/releases/prepare/flow.ts" &&
              target === "packages/apps/blueprint/extract.ts";
            if (
              !extractFile &&
              targetLeaf !== sourceLeaf && !fixture &&
              (!targetLeaf || target !== `${targetLeaf}/mod.ts`)
            ) {
              add(
                file,
                line,
                "leaf",
                `다른 leaf는 mod.ts로 import: ${specifier}`,
              );
            }
          }
        }
      }
      if (
        inside(file, "apps/shell") && target?.startsWith("packages/") &&
        !["contracts", "design", "sdk"].includes(target.split("/")[1])
      ) {
        add(
          file,
          line,
          "shell",
          `shell은 contracts·design·sdk만 import: ${specifier}`,
        );
      }
      // leaf의 testing/ fixture는 제품 코드가 import하지 않는다(core module graph에 테스트 SQLite가 들어가지 않게).
      if (
        !test && target && /^packages\/[^/]+\/.+\/testing\//.test(target) &&
        directory(target) !== directory(file) &&
        !inside(file, directory(target))
      ) {
        add(
          file,
          line,
          "testing",
          `leaf의 testing/은 *_test.ts에서만 import: ${specifier}`,
        );
      }
      if (
        !test && !inside(file, "apps/core/testing") && target &&
        inside(target, "apps/core/testing")
      ) {
        add(
          file,
          line,
          "testing",
          `apps/core/testing은 *_test.ts에서만 import: ${specifier}`,
        );
      }
    }
  }
  checkBlueprintGraph(sources, add);
  for (const edge of cyclicEdges(edges)) {
    add(
      edge.file,
      edge.line,
      "contracts-cycle",
      `contracts 최상위 사이 순환: ${edge.from} → ${edge.to}`,
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
