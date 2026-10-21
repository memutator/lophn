import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { PlaceFiles } from "../place-store.ts";
import type { SkillFiles } from "../skills.ts";

// 동기 파일 눈이다. 동기 file API는 core 프로세스의 module graph에 둘 수 없어
// 이 module은 writer·reader Worker 안에서만 URL로 연다(packages/core/lophn-agent/register.ts).

function missing(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// 같은 폴더의 임시 파일에 쓴 뒤 rename으로 바꿔 끼운다. 읽는 쪽은 이전 파일 전체나 새 파일 전체만 본다.
export function createNodePlaceFiles(): PlaceFiles {
  return {
    read(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    writeAtomic(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${crypto.randomUUID()}.tmp`;
      try {
        writeFileSync(temp, text, "utf8");
        renameSync(temp, path);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    },
  };
}

// symlink는 lstat로 보고 따라가지 않는다. 상한을 넘는 파일은 읽지 않고 complete false로 알린다.
export function createNodeSkillFiles(): SkillFiles {
  return {
    list(dir) {
      try {
        return readdirSync(dir);
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    kind(path) {
      try {
        const info = lstatSync(path);
        if (info.isSymbolicLink()) return "symlink";
        if (info.isDirectory()) return "dir";
        if (info.isFile()) return "file";
        return null;
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    read(path, maxBytes) {
      try {
        const info = lstatSync(path);
        if (!info.isFile()) return null;
        if (info.size > maxBytes) return { text: "", complete: false };
        return { text: readFileSync(path, "utf8"), complete: true };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
  };
}
