import { existsSync } from "node:fs";
import type { FolderResolver } from "../ports.ts";

// 동기 file API를 쓴다. barrel(`mod.ts`)에 두지 않고 register.ts가 직접 import한다.
export function createFolderResolver(): FolderResolver {
  return {
    exists(folderPath) {
      return existsSync(folderPath);
    },
  };
}
