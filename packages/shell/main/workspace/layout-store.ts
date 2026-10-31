// <home>/shell/layouts/<prj_id>.json(판 5~7)은 읽기만 한다. place layout이 없을 때
// place-layout-store가 여기서 읽어 판 8로 올린다. 이 파일은 고치지 않는다.
import { join } from "node:path";

import {
  defaultStoreDeps,
  fsError,
  type StoreDeps,
  type StoreResult,
} from "./atomic-file.ts";
import { type LayoutResult, parseLayoutFile } from "./layout.ts";

/** project마다 파일 하나다. 이름은 바뀔 수 있어 id를 쓴다. */
function layoutPath(dataRoot: string, project: string): string {
  return join(dataRoot, "shell", "layouts", `${project}.json`);
}

export interface LayoutStore {
  /** 그 project의 layout. 파일이 없으면 null이고 손상은 안전한 오류다. */
  read(project: string): Promise<StoreResult<LayoutResult | null>>;
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
  };
}
