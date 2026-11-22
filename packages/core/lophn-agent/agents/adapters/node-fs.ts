import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MessageImageFiles } from "../../message-images.ts";
import type { AvatarImageFiles } from "../avatar-asset.ts";
import type { AgentFileSystem } from "../ports.ts";

// 같은 폴더의 임시 파일에 쓴 뒤 rename으로 바꿔 끼운다. rename은 같은 폴더 안에서 원자적이라
// 읽는 쪽은 이전 파일 전체나 새 파일 전체만 본다. 실패하면 임시 파일을 지우고 던진다.
function replaceWhole(path: string, write: (temp: string) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    write(temp);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function createNodeAgentFiles(): AgentFileSystem {
  return {
    read(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    writeAtomic(path, text) {
      replaceWhole(path, (temp) => writeFileSync(temp, text, "utf8"));
    },
    remove(path) {
      rmSync(path, { force: true });
    },
    list(path) {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return [];
        throw error;
      }
    },
    ensureFolder(path) {
      mkdirSync(path, { recursive: true });
    },
  };
}

// avatar 이미지는 바이트 그대로 다룬다. 글처럼 UTF-8로 바꾸면 바이트가 달라진다. core 프로세스가
// 올리는 바이트는 1 MiB 이하라 비동기 IO로 읽고 쓴다(동기 file API는 core graph에 두지 않는다).
export function createNodeAvatarImageFiles(): AvatarImageFiles {
  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    async writeAtomic(path, bytes) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temp, bytes);
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  };
}

// 메시지 이미지는 avatar 이미지와 같은 바이트 읽기·원자 쓰기에 파일이 있는지 보는 길을 더한다.
export function createNodeMessageImageFiles(): MessageImageFiles {
  return {
    ...createNodeAvatarImageFiles(),
    async exists(path) {
      try {
        return (await stat(path)).isFile();
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return false;
        throw error;
      }
    },
  };
}
