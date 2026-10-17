// 문서 속 저장소 path 검사. 실행: deno run --allow-read tools/check-docs.ts [root]
import { parse } from "@std/yaml";

type Issue = { where: string; message: string };
type Node = Record<string, unknown>;

const REGISTRY = "project-docs/context-component-registry.yaml";
const BOUNDARY = "project-docs/boundary-catalog.yaml";
const SOURCES = ["AGENTS.md", ".claude/skills", "project-docs"];
// 앞으로 생길 path와 옛 path를 적는 곳이라 지금 있는 path와 맞지 않는다.
const EXCLUDED = [
  "project-docs/products/change-log/",
  "project-docs/issues/archived/",
  "project-docs/plan/",
  "project-docs/products/roadmap/",
];
// harness 문서의 `tools/…`는 packages/core/lophn-agent/tools/…라 저장소 root의 tools/와 헷갈린다.
// 그래서 root 기준 전체 path만 path로 본다.
const PREFIXES = ["packages/", "project-docs/", "tools/", ".claude/"];
const SKIPPED = /[<>*{}]|\.\.\.|…/;

// 제외 폴더는 비어 있으면 git에 없고, dist/는 build가 만드는 것(.gitignore)이라 clone에 없다.
function skipped(path: string): boolean {
  return SKIPPED.test(path) || path.includes("/dist/") ||
    EXCLUDED.some((e) => path.startsWith(e));
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function docs(root: string, path: string): Promise<string[]> {
  if (EXCLUDED.some((e) => `${path}/`.startsWith(e))) return [];
  const stat = await Deno.stat(`${root}/${path}`).catch(() => null);
  if (!stat) return [];
  if (stat.isFile) return /\.(md|yaml)$/.test(path) ? [path] : [];
  const found: string[] = [];
  for await (const entry of Deno.readDir(`${root}/${path}`)) {
    if (entry.name === "node_modules") continue;
    found.push(...await docs(root, `${path}/${entry.name}`));
  }
  return found;
}

async function checkFile(root: string, file: string, issues: Issue[]) {
  const lines = (await Deno.readTextFile(`${root}/${file}`)).split("\n");
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const [, text] of line.matchAll(/`([^`]+)`/g)) {
      if (/\s/.test(text) || skipped(text)) continue;
      if (!PREFIXES.some((p) => text.startsWith(p))) continue;
      if (!await exists(`${root}/${text}`)) {
        issues.push({
          where: `${file}:${index + 1}`,
          message: `없는 path: ${text}`,
        });
      }
    }
  }
}

// boundary ID: elements를 children까지 돈 id와 interfaces의 id.
async function boundaryIds(root: string): Promise<Set<string>> {
  const catalog = parse(
    await Deno.readTextFile(`${root}/${BOUNDARY}`),
  ) as Node;
  const ids = new Set<string>();
  const visit = (list: unknown) => {
    for (const node of (list ?? []) as Node[]) {
      ids.add(String(node.id));
      visit(node.children);
    }
  };
  visit(catalog.elements);
  visit(catalog.interfaces);
  return ids;
}

async function checkRegistry(root: string, issues: Issue[]) {
  const registry = parse(
    await Deno.readTextFile(`${root}/${REGISTRY}`),
  ) as Node;
  const ids = await boundaryIds(root);
  const roles = new Set(
    ((registry.roles ?? []) as Node[]).map((r) => String(r.id)),
  );
  const add = (message: string) => issues.push({ where: REGISTRY, message });
  for (const c of (registry.components ?? []) as Node[]) {
    const id = String(c.id);
    if (!skipped(String(c.path)) && !await exists(`${root}/${c.path}`)) {
      add(`${id} path가 없음: ${c.path}`);
    }
    for (const role of (c.roles ?? []) as string[]) {
      if (!roles.has(role)) add(`${id} roles에 없는 role: ${role}`);
    }
    const reasons = (c.change_reasons ?? {}) as Node;
    for (const b of (reasons.boundaries ?? []) as string[]) {
      if (!ids.has(b)) add(`${id} boundary-catalog에 없는 ID: ${b}`);
    }
    for (const p of (reasons.paths ?? []) as string[]) {
      if (!await exists(`${root}/${p}`)) add(`${id} paths에 없는 path: ${p}`);
    }
  }
}

export async function checkDocs(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const source of SOURCES) {
    for (const file of await docs(root, source)) {
      await checkFile(root, file, issues);
    }
  }
  await checkRegistry(root, issues);
  return issues;
}

if (import.meta.main) {
  try {
    const root = Deno.args[0] ?? Deno.cwd();
    const issues = await checkDocs(root);
    for (const issue of issues) {
      console.error(`${issue.where} ${issue.message}`);
    }
    if (!issues.length) console.log("docs: 통과");
    Deno.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `docs: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
