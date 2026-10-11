import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentFileSystem } from "../ports.ts";

// 같은 폴더의 임시 파일에 쓴 뒤 rename으로 바꿔 끼운다. rename은 같은 폴더 안에서 원자적이라
// 읽는 쪽은 이전 파일 전체나 새 파일 전체만 본다. 실패하면 임시 파일을 지우고 던진다.
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
    remove(path) {
      rmSync(path, { force: true });
    },
  };
}
