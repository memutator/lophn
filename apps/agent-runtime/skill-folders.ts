import { err, ok, type Result, systemClock } from "../../packages/base/mod.ts";
import {
  type AgentPlace,
  skillFoldersSetting,
  skillsOffSetting,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { settingsGet } from "../../packages/protocol/platform/mod.ts";
import {
  discoverSkills,
  SKILL_BODY_MAX_BYTES,
  type SkillDiscovery,
  type SkillEntry,
  type SkillFilesPort,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 제품 runtime의 skill 발견이다(extensions R1, R10, R32). 출처는 그 agent 자리의 skill 폴더
// (`<LOPHN_HOME>/{projects,apps}/<id>/skills`), 등록 순서의 설정 `lophn-agent.extensions.skill_folders`,
// data root의 개인 보관소(`<LOPHN_HOME>/skills`), 설치 묶음에 동봉된 `assets/skills` 넷뿐이고 이 순서로
// 찾는다. 다른 자리의 폴더·상위 폴더·앱 소스·다른 harness 보관소·원격은 열지 않는다. 제외 사유
// (skipped·shadowing)는 RunBasis·RunContext에 자리가 없어 `discoverProductSkills`의 결과로만 남고 run에는
// entry만 오른다.

// 자리·개인 보관소·동봉 폴더의 위치다. null은 그 출처가 없는 것이다. 테스트는 temp 폴더를 끼운다.
export type SkillStores = {
  place?: string | null;
  personal: string | null;
  bundled: string | null;
};

// 동봉 skill 폴더다(설치 묶음 root의 assets/skills). 폴더가 없으면 동봉 skill이 없는 것이다.
// core의 `agentRuntimeLaunchSpec`이 같은 위치를 읽기 허락에 넣는다.
export const BUNDLED_SKILLS_ROOT = new URL(
  "../../assets/skills",
  import.meta.url,
).pathname;

export function productSkillStores(place: AgentPlace | null): SkillStores {
  const home = Deno.env.get("LOPHN_HOME");
  const root = home !== undefined && home.startsWith("/")
    ? home.replace(/\/+$/, "")
    : null;
  return {
    place: root === null || place === null
      ? null
      : `${root}/${
        place.kind === "project" ? "projects" : "apps"
      }/${place.id}/skills`,
    personal: root === null ? null : `${root}/skills`,
    bundled: BUNDLED_SKILLS_ROOT,
  };
}

export async function registeredSkillEntries(
  machine: CoreCall,
  stores: SkillStores,
): Promise<readonly SkillEntry[]> {
  const discovered = await discoverProductSkills(machine, stores);
  return discovered === null ? [] : discovered.entries;
}

// 발견 결과 전체다(entries·skipped·shadowing). 읽을 수 없으면 null이다.
export async function discoverProductSkills(
  machine: CoreCall,
  stores: SkillStores,
): Promise<SkillDiscovery | null> {
  const { roots, off } = await globalSkillSettings(machine);
  const port = productFiles(roots, stores);
  const discovered = await discoverSkills({
    port,
    clock: systemClock,
    registered_roots: roots,
    // 아직 없는 자리·개인 보관소·동봉 폴더는 제외 진단이 아니라 그 출처가 비어 있는 것이다.
    place_store: await presentFolder(port, stores.place ?? null),
    personal_store: await presentFolder(port, stores.personal),
    bundled_root: await presentFolder(port, stores.bundled),
    max_file_bytes: SKILL_BODY_MAX_BYTES,
    selection: null,
  });
  if (!discovered.ok) return null;
  // 전역에서 끈 skill은 전역 층의 같은 이름만 가린다. 자리 층의 것은 그대로 둔다(extensions R4, R32).
  return {
    ...discovered.value,
    entries: discovered.value.entries.filter((entry) =>
      entry.source_kind === "place" || !off.includes(entry.name)
    ),
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

// 등록 root·자리·개인 보관소·동봉 폴더와 그 아래만 연다. symlink는 lstat로 보고 따라가지 않는다.
// ~/.lophn, ~/.config/lophn, home 자체는 등록돼 있어도 열지 않는다. 자리 폴더와 개인 보관소는 data
// root 안의 skills 폴더 하나씩만 예외로 연다.
function productFiles(
  roots: readonly string[],
  stores: SkillStores,
): SkillFilesPort {
  const allowed = (path: string): boolean =>
    (stores.place != null && under(stores.place, path)) ||
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
