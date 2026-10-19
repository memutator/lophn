import type { VersionRef } from "../types.ts";
import { hashText, hashValue } from "./hash.ts";
import {
  type Deps,
  REGISTRY_DIR,
  REPO_ROOT,
  resolveVersion,
} from "./registry.ts";
import { sha256Hex } from "../../../packages/base/mod.ts";

// 코드에서 `defineTool({ name:`으로 tool을 정의하는 file 전부다. 새 file이 생기면 runtime에 들어
// 낡게 표시되는 쪽이라 안전하고, 어긋남은 currentVersions가 TOOL_ORDER와 맞춰 보아 드러낸다.
export const TOOL_FILES: readonly string[] = [
  "packages/core/apps/agent-tools/app.ts",
  "packages/core/apps/agent-tools/package.ts",
  "packages/core/apps/agent-tools/release.ts",
  "packages/core/apps/agent-tools/ticket.ts",
  "packages/core/apps/agent-tools/visual.ts",
  "packages/core/problems/agent-tools.ts",
  "packages/core/lophn-agent/tools/bundles/skill.ts",
  "packages/core/lophn-agent/tools/bundles/file.ts",
  "packages/core/lophn-agent/tools/bundles/call.ts",
  "packages/core/lophn-agent/tools/bundles/web.ts",
  "packages/core/lophn-agent/tools/bundles/ask.ts",
  "packages/core/lophn-agent/tools/bundles/shell.ts",
  "packages/core/agent-roles/tools/operator.ts",
  "packages/core/agent-roles/tools/context.ts",
  "packages/core/agent-roles/tools/kind.ts",
  "packages/core/agent-roles/tools/instructions.ts",
  "packages/core/agent-roles/tools/guide.ts",
];

export type FileGroup =
  | { group: "none" }
  | {
    group:
      | "core"
      | "assembly"
      | "runtime"
      | "instruction"
      | "guide"
      | "template"
      | "tool";
  }
  | { group: "skill"; name: string };

const ROLES = "packages/core/agent-roles/roles";
const NO_PACKAGE = /^packages\/(shell|design)\//;
const INSTRUCTION = new RegExp(
  `^${ROLES}/(lophn|project-manager|app-engineer|operator)/prompt\\.md$`,
);
const GUIDE = new RegExp(`^${ROLES}/lophn/guides/[^/]+\\.md$`);
const SKILL =
  /^packages\/(?:core\/agent-roles|coding-agent\/guides)\/skills\/([^/]+)\//;
const RUNTIME = [
  "packages/core/lophn-agent/",
  "packages/core/agent-roles/",
  "packages/core/main/agent-runtime/",
  "packages/core/main/agent-tools.ts",
  "packages/core/apps/agent-tools/",
  "packages/core/problems/agent-tools.ts",
];
const CORE = /^packages\/(base|protocol|core|sdk|coding-agent)\//;

// 위에서부터 처음 맞는 줄이 이긴다. rel은 repo root 기준 `/` 경로다.
export function classifyPath(rel: string): FileGroup {
  const none = { group: "none" } as const;
  if (
    rel.split("/").includes("node_modules") || NO_PACKAGE.test(rel) ||
    /_test\.tsx?$/.test(rel)
  ) return none;
  if (!rel.startsWith("packages/")) {
    return rel === "deno.json" || rel === "deno.lock"
      ? { group: "core" }
      : none;
  }
  if (INSTRUCTION.test(rel) || rel === `${ROLES}/prompts.ts`) {
    return { group: "instruction" };
  }
  if (GUIDE.test(rel) || rel === `${ROLES}/guides.ts`) {
    return { group: "guide" };
  }
  const skill = SKILL.exec(rel);
  if (skill !== null) return { group: "skill", name: skill[1] };
  if (rel.startsWith("packages/core/apps/packages/template/app/")) {
    return { group: "template" };
  }
  if (rel.startsWith("packages/core/lophn-agent/prompt-assembly/")) {
    return { group: "assembly" };
  }
  if (TOOL_FILES.includes(rel)) return { group: "tool" };
  if (RUNTIME.some((p) => rel.startsWith(p))) return { group: "runtime" };
  if (CORE.test(rel)) return { group: "core" };
  return none;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".dev-data"]);

// dir 아래 일반 file의 상대 경로. 없는 폴더는 빈 목록이다. symlink는 따라가지 않는다.
export async function walkFiles(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        if (SKIP_DIRS.has(entry.name)) continue;
        found.push(
          ...await walkFiles(`${dir}/${entry.name}`, `${prefix}${entry.name}/`),
        );
      } else if (entry.isFile) found.push(`${prefix}${entry.name}`);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return found;
}

// root 아래 packages/와 root의 deno.json, deno.lock. 경로 정렬 순서.
export async function listFiles(root: string): Promise<string[]> {
  const files = await walkFiles(`${root}/packages`, "packages/");
  for (const name of ["deno.json", "deno.lock"]) {
    try {
      if ((await Deno.stat(`${root}/${name}`)).isFile) files.push(name);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return files.sort();
}

async function hashPaths(root: string, paths: string[]): Promise<string> {
  const pairs: [string, string][] = [];
  for (const path of paths) {
    pairs.push([path, await sha256Hex(await Deno.readFile(`${root}/${path}`))]);
  }
  return hashValue(pairs);
}

export async function hashGroup(
  root: string,
  group: "core" | "assembly" | "runtime",
): Promise<string> {
  const files = (await listFiles(root)).filter((f) =>
    classifyPath(f).group === group
  );
  return hashPaths(root, files);
}

// tool 정본 이름 → 그것을 정의한 file과 그 글의 hash. 한 file이 정의한 tool은 함께 바뀐다.
export async function toolFileTable(
  root: string,
): Promise<Map<string, { file: string; hash: string }>> {
  const table = new Map<string, { file: string; hash: string }>();
  for (const file of TOOL_FILES) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${root}/${file}`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
    const hash = await hashText(text);
    for (const m of text.matchAll(/defineTool\(\{\s*name:\s*"([^"]+)"/g)) {
      table.set(m[1], { file, hash });
    }
  }
  return table;
}

export async function coreVersion(deps: Deps = {}): Promise<VersionRef> {
  const hash = await hashGroup(deps.root ?? REPO_ROOT, "core");
  const { ref } = await resolveVersion(deps.registryDir ?? REGISTRY_DIR, {
    kind: "core",
    name: "core",
    hash,
  });
  return ref;
}

// `tests/eval/checks/**`의 file(`_test.ts` 제외) 전체의 버전.
export async function checksVersion(deps: Deps = {}): Promise<VersionRef> {
  const root = deps.checksRoot ?? deps.root ?? REPO_ROOT;
  const files =
    (await walkFiles(`${root}/tests/eval/checks`, "tests/eval/checks/"))
      .filter((f) => !f.endsWith("_test.ts")).sort();
  const { ref } = await resolveVersion(deps.registryDir ?? REGISTRY_DIR, {
    kind: "checks",
    name: "checks",
    hash: await hashPaths(root, files),
  });
  return ref;
}
