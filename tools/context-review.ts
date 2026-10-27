// 바뀐 코드에서 다시 볼 context 조각을 뽑는다. 계획이 land된 뒤 planner가 돌린다.
// 실행: node tools/context-review.ts --range <git range>
//       node tools/context-review.ts --modules <path,path,...>
// 바뀐 file → module-catalog의 module → boundary ID → registry의 change_reasons.boundaries가 그 ID인 조각.
// change_reasons.paths가 바뀐 file을 덮는 조각도 낸다. module이 부모 boundary(예: core/apps → apps)에 걸려 있으면
// 어느 자식이 바뀌었는지 path로는 모르므로 그 아래 boundary(app-releases, app-runtime …)에 걸린 조각도 낸다.
// 자식이 자기 module을 따로 가지면(core 아래 approvals) 그 자식은 넓히지 않는다.
// --range면 조각의 path 자체가 그 범위에서 바뀌었는지(=같은 변경에서 고쳤는지)도 표시한다.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parse } from "yaml";

type Node = Record<string, unknown>;
type Component = {
  id: string;
  kind: string;
  path: string;
  change_reasons?: { boundaries?: string[]; paths?: string[] };
};

const MODULES = "project-docs/module-catalog.yaml";
const BOUNDARIES = "project-docs/boundary-catalog.yaml";
const REGISTRY = "project-docs/context-component-registry.yaml";

async function read(file: string): Promise<Node> {
  return parse(await readFile(file, "utf8")) as Node;
}

type Captured = { code: number | null; stdout: string; stderr: string };

// stdout·stderr를 끝까지 읽은 뒤 close(exit code)를 기다린다.
function capture(command: string[]): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function changedFiles(range: string): Promise<string[]> {
  const out = await capture(["git", "diff", "--name-only", range]);
  if (out.code !== 0) {
    console.error(out.stderr.trim());
    process.exit(1);
  }
  return out.stdout.split("\n").filter(Boolean);
}

const under = (file: string, prefix: string) => {
  const p = prefix.replace(/\/$/, "");
  return file === p || file.startsWith(p + "/");
};

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const range = arg("--range");
const modulesArg = arg("--modules");
if (!range && !modulesArg) {
  console.error(
    "사용: tools/context-review.ts --range <git range> | --modules <path,...>",
  );
  process.exit(2);
}

const catalog = ((await read(MODULES)).modules ?? []) as {
  path: string;
  boundary: string | null;
}[];
const components = ((await read(REGISTRY)).components ?? []) as Component[];

const files = range ? await changedFiles(range) : [];
// file마다 가장 긴 module path가 그 file의 module이다.
const modules = new Set<string>(
  modulesArg
    ? modulesArg
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : [],
);
for (const file of files) {
  const owner = catalog
    .filter((m) => under(file, m.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (owner) modules.add(owner.path);
}
// boundary → 자식 boundary 전부.
const below = new Map<string, string[]>();
const walk = (list: unknown): string[] => {
  const ids: string[] = [];
  for (const node of (list ?? []) as Node[]) {
    const kids = walk(node.children);
    below.set(String(node.id), kids);
    ids.push(String(node.id), ...kids);
  }
  return ids;
};
walk((await read(BOUNDARIES)).elements);
// 자기 module이 따로 있는 자식(core 아래 approvals 등)은 그 module이 바뀔 때만 걸린다.
const owned = new Set(catalog.map((m) => m.boundary).filter(Boolean));
const boundaries = new Map<string, string>(); // boundary → 걸린 module
for (const m of catalog) {
  if (!modules.has(m.path) || !m.boundary) continue;
  const kids = (below.get(m.boundary) ?? []).filter((b) => !owned.has(b));
  for (const b of [m.boundary, ...kids]) {
    if (!boundaries.has(b)) boundaries.set(b, m.path);
  }
}

const rows: { id: string; kind: string; why: string[]; updated: boolean }[] =
  [];
for (const c of components) {
  const why: string[] = [];
  for (const b of c.change_reasons?.boundaries ?? []) {
    if (boundaries.has(b)) why.push(`boundary ${b} (${boundaries.get(b)})`);
  }
  for (const p of c.change_reasons?.paths ?? []) {
    const hit = files.find((f) => under(f, p));
    if (hit) why.push(`path ${p} (${hit})`);
  }
  if (why.length === 0) continue;
  rows.push({
    id: c.id,
    kind: c.kind,
    why,
    updated: files.some((f) => under(f, c.path)),
  });
}

console.log(
  `바뀐 file ${files.length}, module ${modules.size}, boundary ${boundaries.size}`,
);
console.log(`modules: ${[...modules].sort().join(", ") || "없음"}`);
const toCheck = rows.filter((r) => !r.updated);
const updated = rows.filter((r) => r.updated);
console.log(`\n다시 볼 조각 ${toCheck.length}개 (같은 변경에서 고치지 않음):`);
for (const r of toCheck) {
  console.log(`  ${r.id} [${r.kind}] ← ${r.why.join("; ")}`);
}
if (range) {
  console.log(`\n같은 변경에서 고친 조각 ${updated.length}개:`);
  for (const r of updated) console.log(`  ${r.id} [${r.kind}]`);
}
