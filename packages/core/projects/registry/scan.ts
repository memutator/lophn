import { err, ok, type Result } from "../../../base/mod.ts";
import type { DirectoryEntry, RootScanner } from "./work.ts";
import { symlinkEscapesRoot } from "./rules.ts";

// 테스트와, 실제 순회가 생기기 전 등록이 쓰는 임시 파일 시스템 순회다.
// 실제 경로는 Deno.realPathSync로 푼다. root 밖 symlink는 따라가지 않는다.
export function directoryScanner(): RootScanner {
  return {
    list(root, directory) {
      return listDirectory(root, directory);
    },
    gitignore(root, directory) {
      return readGitignore(root, directory);
    },
  };
}

function absolute(root: string, directory: string): string {
  return directory === "" ? root : `${root}/${directory}`;
}

function listDirectory(
  root: string,
  directory: string,
): Result<readonly DirectoryEntry[]> {
  const path = absolute(root, directory);
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(path)];
  } catch {
    return err({ code: "unavailable", message: "directory cannot be listed" });
  }
  const listed: DirectoryEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymlink) {
      const link = `${path}/${entry.name}`;
      let real: string;
      try {
        real = Deno.realPathSync(link);
      } catch {
        listed.push({ name: entry.name, kind: "symlink" });
        continue;
      }
      const escapes = symlinkEscapesRoot(root, real);
      if (!escapes.ok) return escapes;
      let targetKind: "file" | "directory" = "file";
      try {
        if (Deno.statSync(real).isDirectory) targetKind = "directory";
      } catch {
        targetKind = "file";
      }
      listed.push({
        name: entry.name,
        kind: "symlink",
        targetKind,
        realPath: escapes.value ? real : real,
      });
      continue;
    }
    if (entry.isDirectory) {
      listed.push({ name: entry.name, kind: "directory" });
      continue;
    }
    if (entry.isFile) {
      listed.push({ name: entry.name, kind: "file" });
      continue;
    }
    listed.push({ name: entry.name, kind: "other" });
  }
  return ok(listed);
}

function readGitignore(
  root: string,
  directory: string,
): Result<string | null> {
  const path = `${absolute(root, directory)}/.gitignore`;
  try {
    const info = Deno.lstatSync(path);
    if (info.isSymlink) {
      const real = Deno.realPathSync(path);
      const escapes = symlinkEscapesRoot(root, real);
      if (!escapes.ok) return escapes;
      if (escapes.value) return ok(null);
    }
    return ok(Deno.readTextFileSync(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return ok(null);
    return err({ code: "unavailable", message: "gitignore cannot be read" });
  }
}

// 마지막으로 연 파일이 root 밖이면 추적하지 않는다. 순회와 같은 판정이다.
export function openedFileEscapes(
  root: string,
  realPath: string,
): Result<boolean> {
  return symlinkEscapesRoot(root, realPath);
}
