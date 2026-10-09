import { err, ok, type Result, systemClock } from "../../packages/base/mod.ts";
import { skillFoldersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
import { settingsGet } from "../../packages/contracts/platform/mod.ts";
import {
  discoverSkills,
  SKILL_BODY_MAX_BYTES,
  type SkillEntry,
  type SkillFilesPort,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 제품 runtime의 등록 skill 폴더 검사다(extensions R1, R10). 설정
// `lophn-agent.extensions.skill_folders`만 출처이고, 비었거나 읽을 수 없으면
// 빈 목록이다. 개인 보관소·동봉 폴더·상위 폴더·원격은 열지 않는다.
// 제외 사유는 RunBasis·RunContext에 자리가 없어 entry만 run에 올린다.

export async function registeredSkillEntries(
  machine: CoreCall,
): Promise<readonly SkillEntry[]> {
  const roots = await registeredRoots(machine);
  if (roots.length === 0) return [];
  const discovered = await discoverSkills({
    port: registeredFiles(roots),
    clock: systemClock,
    registered_roots: roots,
    personal_store: null,
    bundled_root: null,
    max_file_bytes: SKILL_BODY_MAX_BYTES,
    selection: null,
  });
  return discovered.ok ? discovered.value.entries : [];
}

async function registeredRoots(
  machine: CoreCall,
): Promise<readonly string[]> {
  const read = await readOf(machine, settingsGet, {
    keys: [skillFoldersSetting.key],
  });
  if (!read.ok) return [];
  const setting = read.value.settings.find((entry) =>
    entry.key === skillFoldersSetting.key
  );
  if (setting === undefined || setting.value === null) return [];
  const shaped = skillFoldersSetting.value_type.safeParse(setting.value);
  if (!shaped.success || shaped.data.length === 0) return [];
  return shaped.data;
}

// 등록 root와 그 아래만 연다. symlink는 lstat로 보고 따라가지 않는다.
// ~/.lophn, ~/.config/lophn, home 자체는 등록돼 있어도 열지 않는다.
function registeredFiles(roots: readonly string[]): SkillFilesPort {
  const allowed = (path: string): boolean =>
    !privateRoot(path) && roots.some((root) => under(root, path));

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
