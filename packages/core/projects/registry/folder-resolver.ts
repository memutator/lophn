import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { err, ok } from "../../../base/mod.ts";
import type { FolderResolver } from "../ports.ts";
import { rootRelation } from "./model.ts";

// 동기 file API를 쓴다. barrel(`mod.ts`)에 두지 않고 register.ts가 직접 import한다.
export function createFolderResolver(): FolderResolver {
  return {
    // 연결 폴더 밖으로 나가는 symlink는 realpath가 연결 폴더 밖이라 거절된다.
    resolveInside(folderPath, subfolder) {
      let root: string;
      let real: string;
      try {
        root = realpathSync(folderPath);
      } catch {
        return err({ code: "invalid_input", message: "folder not found" });
      }
      try {
        real = realpathSync(join(folderPath, subfolder));
        if (!statSync(real).isDirectory()) throw new Error("not a directory");
      } catch {
        return err({
          code: "invalid_input",
          message: "subfolder not found",
        });
      }
      const relation = rootRelation(root, real);
      if (!relation.ok) return relation;
      if (relation.value !== "equal" && relation.value !== "ancestor") {
        return err({
          code: "invalid_input",
          message: "subfolder is outside its folder",
        });
      }
      return ok(real);
    },
    exists(folderPath) {
      return existsSync(folderPath);
    },
  };
}
