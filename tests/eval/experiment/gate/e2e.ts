import { parse } from "yaml";
import { classifyPath } from "../../versions/mod.ts";

export type SelectInput = {
  files: string[]; // 바뀐 file(repo root 기준)
  modules: { path: string; boundary: string | null }[];
  tree: Record<string, string[]>; // boundary id -> 자식 id
  e2e: { file: string; boundaries: string[] }[]; // ["*"]는 contract 줄을 못 읽은 file이라 늘 고른다
};
export type E2eSelection = { files: string[]; all: boolean; reasons: string[] };

type Catalog = Pick<SelectInput, "modules" | "tree"> & {
  known: Set<string>;
  aliases: Record<string, string[]>;
};
type Element = { id: string; children?: Element[] };

export function parseCatalog(
  moduleYaml: string,
  boundaryYaml: string,
): Catalog {
  const mods = parse(moduleYaml) as {
    modules: { path: string; boundary: string | null }[];
  };
  const b = parse(boundaryYaml) as {
    elements: Element[];
    interfaces: { id: string; provided_by: string[] }[];
  };
  const tree: Record<string, string[]> = {};
  const known = new Set<string>();
  const visit = (els: Element[]) => {
    for (const e of els) {
      known.add(e.id);
      tree[e.id] = (e.children ?? []).map((c) => c.id);
      visit(e.children ?? []);
    }
  };
  visit(b.elements);
  const aliases: Record<string, string[]> = {};
  for (const i of b.interfaces) {
    known.add(i.id);
    aliases[i.id] = i.provided_by;
  }
  return {
    modules: mods.modules.map((m) => ({
      path: m.path,
      boundary: m.boundary ?? null,
    })),
    tree,
    known,
    aliases,
  };
}

// `contract:`가 든 주석 줄과 거기서 이어지는 들여쓴 `//` 줄에서 backtick ID를 모은다. 설명 속 다른 ID가 섞이면
// 더 고르는 쪽이라 안전하다. 한 ID도 못 읽으면 ["*"]다.
export function e2eBoundaries(
  testText: string,
  known: Set<string>,
  aliases: Record<string, string[]>,
): string[] {
  const found = new Set<string>();
  let inContract = false;
  for (const line of testText.split("\n")) {
    if (/^\s*\/\/.*contract:/.test(line)) inContract = true;
    else if (!/^\s*\/\/\s{2,}\S/.test(line)) inContract = false;
    if (!inContract) continue;
    for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
      if (!known.has(token)) continue;
      for (const id of aliases[token] ?? [token]) found.add(id);
    }
  }
  return found.size === 0 ? ["*"] : [...found].sort();
}

const E2E_FILE = /^tests\/e2e\/[^/]+_test\.ts$/;
const ALL_E2E_BOUNDARIES = ["base", "protocol", "sdk"];
const TEXT_GROUPS = ["instruction", "skill"];

function descendants(id: string, tree: Record<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(tree[cur] ?? []));
  }
  return seen;
}

export function selectE2e(input: SelectInput): E2eSelection {
  const allFiles = input.e2e.map((e) => e.file).sort();
  const picked = new Set<string>();
  const reasons = new Set<string>();
  const everything = (reason: string): E2eSelection => ({
    files: allFiles,
    all: true,
    reasons: [reason],
  });

  for (const file of input.files) {
    if (E2E_FILE.test(file)) {
      if (allFiles.includes(file)) {
        picked.add(file);
        reasons.add(`${file} → 바뀐 e2e`);
      }
      continue;
    }
    if (
      file.startsWith("tests/support/") ||
      file === "deno.json" ||
      file === "deno.lock"
    )
      return everything(`${file} → 모든 e2e의 바닥`);
    // e2e는 fake model을 쓰므로 진짜 model이 읽는 글은 e2e에 닿지 않는다.
    if (TEXT_GROUPS.includes(classifyPath(file).group)) continue;
    if (
      !file.startsWith("packages/") ||
      /^packages\/(shell|design)\//.test(file)
    )
      continue;

    let module: SelectInput["modules"][number] | undefined;
    for (const m of input.modules) {
      if (
        (file === m.path || file.startsWith(m.path + "/")) &&
        (module === undefined || m.path.length > module.path.length)
      )
        module = m;
    }
    if (module === undefined) return everything(`${file} → module 없음`);
    const boundary = module.boundary;
    if (boundary === null || ALL_E2E_BOUNDARIES.includes(boundary)) {
      return everything(
        `${file} → ${module.path} → ${boundary ?? "boundary 없음"}`,
      );
    }
    const scope = descendants(boundary, input.tree);
    for (const e of input.e2e) {
      if (
        e.boundaries.includes("*") ||
        e.boundaries.some((b) => scope.has(b))
      ) {
        picked.add(e.file);
        reasons.add(`${file} → ${module.path} → ${boundary} → ${e.file}`);
      }
    }
  }
  return { files: [...picked].sort(), all: false, reasons: [...reasons] };
}
