import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  skillFoldersSetting,
  skillsOffSetting,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { settingsGet } from "../../../protocol/config/mod.ts";
import {
  BUNDLED_SKILLS_ROOT,
  discoverSkills,
  SKILL_BODY_MAX_BYTES,
  type SkillDiscovery,
  type SkillEntry,
  type SkillFilesPort,
} from "./skills.ts";
import type { SkillSnapshotDeps } from "./skill-read.ts";
import {
  parseProjectExtensions,
  projectExtensionsPathOf,
  projectSkillsOf,
} from "./project-settings.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";

// 제품 runtime의 skill 발견이다. 출처는 내장 skill 폴더(`extensions/builtin-skills`), 등록 순서의 설정
// `lophn-agent.extensions.skill_folders`, data root의 개인 보관소(`<LOPHN_HOME>/skills`), project place의 skill
// 폴더(`<LOPHN_HOME>/projects/<id>/skills`) 넷뿐이다. 앱 place에는 skill 폴더가 없다. 다른 place의 폴더, 상위 폴더,
// 앱 소스, 다른 harness 보관소, 원격은 열지 않는다. 층은 내장, 전역(등록 폴더와 개인 보관소), project 순이다.

// 내장, 개인 보관소, project 폴더의 위치다. null은 그 출처가 없는 것이다. 테스트는 temp 폴더를 끼운다.
export type SkillStores = {
  bundled: string | null;
  personal: string | null;
  // project place의 skill 폴더다. project에 놓이지 않은 agent는 null이다.
  project: string | null;
  // project에서 끈 이름이 든 파일이다.
  project_file: string | null;
  // data root다. project 폴더를 여는 허락이 이 아래 `projects/<id>`로 좁다.
  root: string | null;
};

export { BUNDLED_SKILLS_ROOT };

function dataRootOfEnv(): string | null {
  const home = Deno.env.get("LOPHN_HOME");
  return home !== undefined && home.startsWith("/")
    ? home.replace(/\/+$/, "")
    : null;
}

export function productSkillStores(place: AgentPlace | null): SkillStores {
  const root = dataRootOfEnv();
  const project = root === null || place === null || place.kind !== "project"
    ? null
    : place.id;
  return {
    bundled: BUNDLED_SKILLS_ROOT,
    personal: root === null ? null : `${root}/skills`,
    project: project === null ? null : projectSkillsOf(root!, project),
    project_file: project === null
      ? null
      : projectExtensionsPathOf(root!, project),
    root,
  };
}

// project에서 끈 이름이다. 파일이 없거나 틀렸으면 끈 것이 없다.
async function projectOff(
  port: SkillFilesPort,
  file: string | null,
): Promise<readonly string[]> {
  if (file === null) return [];
  const read = await port.read(file, SKILL_BODY_MAX_BYTES);
  if (!read.ok || read.value === null || !read.value.complete) return [];
  const parsed = parseProjectExtensions(read.value.text);
  return parsed.ok ? parsed.value.skills_off : [];
}

// 층을 합친 목록이다. 전역과 project에서 끈 것이 enabled false다. agent 정의가 끈 것은 `agentOff`로 더한다.
export async function registeredSkillEntries(
  machine: CoreCall,
  stores: SkillStores,
  agentOff: readonly string[] = [],
): Promise<readonly SkillEntry[]> {
  const discovered = await discoverProductSkills(machine, stores, agentOff);
  return discovered === null ? [] : discovered.entries;
}

// 발견 결과 전체다(entries와 skipped). 읽을 수 없으면 null이다.
export async function discoverProductSkills(
  machine: CoreCall,
  stores: SkillStores,
  agentOff: readonly string[] = [],
): Promise<SkillDiscovery | null> {
  const { roots, off } = await globalSkillSettings(machine);
  const port = productFiles(roots, stores);
  const discovered = await discoverSkills({
    port,
    // 아직 없는 개인 보관소, project 폴더는 제외 진단이 아니라 그 출처가 비어 있는 것이다.
    builtin_root: await presentFolder(port, stores.bundled),
    registered_roots: roots,
    personal_store: await presentFolder(port, stores.personal),
    project_store: await presentFolder(port, stores.project),
    role: null,
    off: [
      ...new Set([
        ...off,
        ...await projectOff(port, stores.project_file),
        ...agentOff,
      ]),
    ],
    max_file_bytes: SKILL_BODY_MAX_BYTES,
  });
  return discovered.ok ? discovered.value : null;
}

// turn 시작에 skill 판을 고정하는 재료다(`createSkillSnapshot`). project마다 폴더가 달라 port는 data root 아래
// 모든 project 폴더를 열 수 있다.
export function productSkillSnapshotDeps(machine: CoreCall): SkillSnapshotDeps {
  const base = productSkillStores(null);
  const stores = (project: string): SkillStores => ({
    ...base,
    project: base.root === null ? null : projectSkillsOf(base.root, project),
    project_file: base.root === null
      ? null
      : projectExtensionsPathOf(base.root, project),
  });
  return {
    port: productFiles([], { ...base, project: null }),
    builtin_root: base.bundled,
    personal_store: base.personal,
    global: async () => {
      const { roots, off } = await globalSkillSettings(machine);
      return { roots, off };
    },
    project: async (project: Id<"prj">) => {
      const where = stores(project);
      const port = productFiles([], where);
      return {
        store: await presentFolder(port, where.project),
        off: await projectOff(port, where.project_file),
      };
    },
  };
}

async function presentFolder(
  port: SkillFilesPort,
  path: string | null,
): Promise<string | null> {
  if (path === null) return null;
  const kind = await port.kind(path);
  return kind.ok && kind.value === null ? null : path;
}

// 등록 폴더(순서대로)와 전역에서 끈 skill 이름이다. 읽지 못하거나 값이 틀리면 둘 다 없는 것으로 본다.
async function globalSkillSettings(
  machine: CoreCall,
): Promise<{ roots: readonly string[]; off: readonly string[] }> {
  const read = await readOf(machine, settingsGet, {
    keys: [skillFoldersSetting.key, skillsOffSetting.key],
  });
  if (!read.ok) return { roots: [], off: [] };
  const valueOf = (key: string): unknown =>
    read.value.settings.find((entry) => entry.key === key)?.value ?? null;
  const roots = skillFoldersSetting.value_type.safeParse(
    valueOf(skillFoldersSetting.key),
  );
  const off = skillsOffSetting.value_type.safeParse(
    valueOf(skillsOffSetting.key),
  );
  return {
    roots: roots.success ? roots.data : [],
    off: off.success ? off.data : [],
  };
}

// 등록 root·내장 폴더·개인 보관소·project 폴더와 그 아래만 연다. symlink는 lstat로 보고 따라가지 않는다.
// ~/.lophn, ~/.config/lophn, home 자체는 등록돼 있어도 열지 않는다. 개인 보관소와 project의 skill 폴더, 끈 이름 파일은
// data root 안의 정해진 곳만 예외로 연다.
function productFiles(
  roots: readonly string[],
  stores: SkillStores,
): SkillFilesPort {
  const projectPath = (path: string): boolean => {
    if (stores.root === null) return false;
    const target = lexical(path);
    const base = lexical(stores.root);
    if (target === null || base === null) return false;
    return new RegExp(
      `^${
        base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      }/projects/prj_[0-9a-z]+/(skills(/.*)?|extensions\\.json)$`,
    ).test(target);
  };
  const allowed = (path: string): boolean =>
    projectPath(path) ||
    (stores.personal !== null && under(stores.personal, path)) ||
    (!privateRoot(path) &&
      (roots.some((root) => under(root, path)) ||
        (stores.bundled !== null && under(stores.bundled, path))));

  const openStat = async (
    path: string,
  ): Promise<Result<Deno.FileInfo | null>> => {
    if (!allowed(path)) {
      return err({
        code: "forbidden",
        message: "skill path is outside the registered folder",
      });
    }
    try {
      return ok(await Deno.lstat(path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return ok(null);
      return err({
        code: "unavailable",
        message: "skill path could not be checked",
      });
    }
  };

  return {
    async list(dir) {
      const info = await openStat(dir);
      if (!info.ok) return info;
      if (info.value === null) return ok(null);
      if (info.value.isSymlink || !info.value.isDirectory) {
        return err({
          code: "forbidden",
          message: "skill folder is not a plain directory",
        });
      }
      try {
        const names: string[] = [];
        for await (const entry of Deno.readDir(dir)) names.push(entry.name);
        return ok(names);
      } catch {
        return err({
          code: "unavailable",
          message: "skill folder could not be listed",
        });
      }
    },
    async kind(path) {
      const info = await openStat(path);
      if (!info.ok) return info;
      if (info.value === null) return ok(null);
      if (info.value.isSymlink) return ok("symlink");
      if (info.value.isDirectory) return ok("dir");
      if (info.value.isFile) return ok("file");
      return ok(null);
    },
    async read(path, maxBytes) {
      const info = await openStat(path);
      if (!info.ok) return info;
      if (
        info.value === null || info.value.isSymlink || !info.value.isFile
      ) {
        return ok(null);
      }
      if (info.value.size > maxBytes) {
        return ok({ text: "", complete: false });
      }
      try {
        return ok({ text: await Deno.readTextFile(path), complete: true });
      } catch {
        return err({
          code: "unavailable",
          message: "skill file could not be read",
        });
      }
    },
    async executable(path) {
      const info = await openStat(path);
      if (!info.ok) return info;
      if (
        info.value === null || info.value.isSymlink || !info.value.isFile
      ) {
        return ok(null);
      }
      const mode = info.value.mode;
      return ok(mode === null ? null : (mode & 0o111) !== 0);
    },
  };
}

function under(root: string, path: string): boolean {
  const base = lexical(root);
  const target = lexical(path);
  if (base === null || target === null) return false;
  const separator = base.includes("\\") ? "\\" : "/";
  return target === base || target.startsWith(`${base}${separator}`);
}

function privateRoot(path: string): boolean {
  const home = Deno.env.get("HOME");
  if (home === undefined || home.length === 0) return false;
  const base = lexical(home);
  const target = lexical(path);
  if (base === null || target === null) return false;
  if (target === base) return true;
  for (const suffix of ["/.lophn", "/.config/lophn"] as const) {
    const root = `${base}${suffix}`;
    if (target === root || target.startsWith(`${root}/`)) return true;
  }
  return false;
}

// `.`와 `..`만 접고 symlink는 풀지 않는다. 절대 경로가 아니면 null이다.
function lexical(path: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  if (!windows && !path.startsWith("/")) return null;
  const drive = windows ? path.slice(0, 2) : "";
  const body = windows ? path.slice(2) : path;
  const kept: string[] = [];
  for (const piece of body.split(/[\\/]+/)) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      if (kept.length === 0) return null;
      kept.pop();
      continue;
    }
    kept.push(piece);
  }
  return windows ? `${drive}\\${kept.join("\\")}` : `/${kept.join("/")}`;
}
