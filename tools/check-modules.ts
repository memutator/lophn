// module catalog와 boundary catalog 검사. 실행: deno run --allow-read tools/check-modules.ts [root]
import { parse } from "@std/yaml";

type Issue = { file: string; message: string };
type Node = Record<string, unknown>;

const BOUNDARY = "project-docs/boundary-catalog.yaml";
const MODULES = "project-docs/module-catalog.yaml";
const EXCLUDED = new Set(["node_modules", "dist", ".claude", ".dev-data"]);
const KINDS = new Set([
  "subsystem",
  "application",
  "component",
  "library",
  "extension",
  "interface",
  "guidance",
  "bundle",
  "actor",
]);
const INTERFACE_TYPES = new Set(["api", "spi", "protocol"]);
const REFERENCES = ["depends_on", "bundles"];
const INTERFACE_FIELDS = [
  "interface_type",
  "defined_by",
  "provided_by",
  "used_by",
];

async function read(root: string, file: string): Promise<Node> {
  return parse(await Deno.readTextFile(`${root}/${file}`)) as Node;
}

async function folders(root: string, parent: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(`${root}/${parent}`)) {
    if (entry.isDirectory && !EXCLUDED.has(entry.name)) {
      found.push(`${parent}/${entry.name}`);
    }
  }
  return found;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// boundary-catalog 머리말 7장: elements를 재귀로 돈 것과 interfaces로 ID index를 만들고 참조와 칸을 본다.
function checkBoundaries(catalog: Node, issues: Issue[]): Set<string> {
  const add = (message: string) => issues.push({ file: BOUNDARY, message });
  const nodes: Node[] = [];
  const visit = (list: unknown) => {
    for (const node of (list ?? []) as Node[]) {
      nodes.push(node);
      visit(node.children);
    }
  };
  visit(catalog.elements);
  const elementCount = nodes.length;
  nodes.push(...((catalog.interfaces ?? []) as Node[]));

  const ids = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const id = String(node.id);
    if (ids.has(id)) add(`ID가 겹침: ${id}`);
    ids.add(id);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
      add(`ID는 영어 kebab-case: ${id}`);
    }
    for (const field of ["kind", "description"]) {
      if (!node[field]) add(`${id}: ${field} 필요`);
    }
    if (!KINDS.has(String(node.kind))) add(`${id}: 모르는 kind ${node.kind}`);
    const isInterface = node.kind === "interface";
    if (isInterface !== (index >= elementCount)) {
      add(`${id}: interface는 interfaces에만, 그 밖은 elements에만 둔다`);
    }
    for (const field of INTERFACE_FIELDS) {
      if (isInterface && !node[field]) add(`${id}: ${field} 필요`);
      if (!isInterface && node[field] !== undefined) {
        add(`${id}: ${field}는 interface에만 쓴다`);
      }
    }
    if (isInterface && !INTERFACE_TYPES.has(String(node.interface_type))) {
      add(`${id}: 모르는 interface_type ${node.interface_type}`);
    }
    if (node.bundles !== undefined && node.kind !== "bundle") {
      add(`${id}: bundles는 bundle에만 쓴다`);
    }
  }
  for (const node of nodes) {
    const refs = [
      ...REFERENCES.flatMap((f) => (node[f] ?? []) as string[]),
      ...((node.provided_by ?? []) as string[]),
      ...((node.used_by ?? []) as string[]),
      ...(typeof node.defined_by === "string" ? [node.defined_by] : []),
    ];
    for (const ref of refs) {
      if (!ids.has(ref)) add(`${node.id}: 없는 ID를 가리킴: ${ref}`);
    }
  }
  return ids;
}

export async function checkModules(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const add = (message: string) => issues.push({ file: MODULES, message });
  const ids = checkBoundaries(await read(root, BOUNDARY), issues);
  const entries = ((await read(root, MODULES)).modules ?? []) as Node[];

  const listed = new Set<string>();
  for (const entry of entries) {
    const path = String(entry.path);
    if (listed.has(path)) add(`path가 겹침: ${path}`);
    listed.add(path);
    if (!await exists(`${root}/${path}`)) add(`없는 path: ${path}`);
    if (entry.boundary === null) {
      if (!entry.notes) add(`${path}: boundary가 null이면 notes 필요`);
    } else if (!ids.has(String(entry.boundary))) {
      add(`${path}: boundary-catalog에 없는 ID: ${entry.boundary}`);
    }
    const agents = `${path}/AGENTS.md`;
    const hasAgents = await exists(`${root}/${agents}`);
    if (entry.doc !== undefined && entry.doc !== agents) {
      add(`${path}: doc은 ${agents}`);
    }
    if (entry.doc !== undefined && !hasAgents) add(`${path}: ${agents}가 없음`);
    if (entry.doc === undefined && hasAgents) {
      add(`${path}: doc 칸에 ${agents} 필요`);
    }
  }

  const expected = [
    "tools",
    ...await folders(root, "packages"),
    ...await folders(root, "packages/core"),
    ...await folders(root, "packages/shell"),
  ].filter((path) => path !== "packages/core" && path !== "packages/shell");
  for (const path of expected) {
    if (!listed.has(path)) add(`catalog에 없는 폴더: ${path}`);
  }
  return issues;
}

if (import.meta.main) {
  try {
    const root = Deno.args[0] ?? Deno.cwd();
    const issues = await checkModules(root);
    for (const issue of issues) console.error(`${issue.file} ${issue.message}`);
    if (!issues.length) console.log("modules: 통과");
    Deno.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `modules: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
