// <home>/shell/layouts/<prj_id>.json은 main만 쓴다. 원자 교체 temp 파일 뒤 rename이고,
// 폴더 0700·파일 0600(Windows는 mode bit가 없어 기본 ACL이 사용자 limit이다)을
// 유지한다. 본문·결정·token은 여기 남지 않는다.
import { join } from "node:path";

import {
  defaultStoreDeps,
  fsError,
  type StoreDeps,
  type StoreResult,
  writeFileAtomic,
} from "./atomic-file.ts";
import { type LayoutResult, parseLayoutFile } from "./layout.ts";

/** project마다 파일 하나다. 이름은 바뀔 수 있어 id를 쓴다. */
function layoutPath(dataRoot: string, project: string): string {
  return join(dataRoot, "shell", "layouts", `${project}.json`);
}

export interface LayoutStore {
  /** 그 project의 layout. 파일이 없으면 null이고 손상은 안전한 오류다. */
  read(project: string): Promise<StoreResult<LayoutResult | null>>;
  /** 원자 교체로 쓴다. 실패하면 기존 파일을 그대로 둔다. */
  write(project: string, content: string): Promise<StoreResult<null>>;
}

export function createLayoutStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): LayoutStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  return {
    async read(project: string): Promise<StoreResult<LayoutResult | null>> {
      const file = layoutPath(dataRoot, project);
      let raw: Uint8Array;
      try {
        raw = await impl.readFile(file);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { ok: true, value: null };
        return {
          ok: false,
          error: fsError(code === "EISDIR" ? "not_a_directory" : "unreadable"),
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        // 손상 파일은 도메인 데이터를 바꾸지 않고 안전한 오류로 둔다.
        return { ok: true, value: { ok: false, reason: "corrupt" as const } };
      }
      return { ok: true, value: parseLayoutFile(parsed) };
    },
    write(project: string, content: string): Promise<StoreResult<null>> {
      return writeFileAtomic(layoutPath(dataRoot, project), content, impl);
    },
  };
}
