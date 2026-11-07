// <home>/shell/workspaces/<workspace>.json은 main만 쓴다(원자 교체와 mode는 atomic-file.ts). workspace는 `home`이거나
// project id, app id다. 파일이 없으면 null(기본 layout)이다. 옛 layouts/<prj_id>.json은 읽지 않는다.
import { join } from "node:path";

import {
  defaultStoreDeps,
  fsError,
  type StoreDeps,
  type StoreResult,
  writeFileAtomic,
} from "./atomic-file.ts";
import {
  isWorkspaceKey,
  parseWorkspaceLayoutFile,
  type WorkspaceLayoutResult,
  validateWorkspaceLayout,
} from "./workspace-layout.ts";

export type WorkspaceStoreResult<T> =
  | StoreResult<T>
  | { ok: false; error: { code: "invalid_input"; message: string } };

const INVALID_WORKSPACE = {
  ok: false,
  error: { code: "invalid_input", message: "invalid workspace key" },
} as const;

export interface WorkspaceLayoutStore {
  /** 그 workspace의 layout. 어디에도 없으면 null이고 손상·미지원 판은 안전한 오류 값이다. */
  read(
    workspace: string,
  ): Promise<WorkspaceStoreResult<WorkspaceLayoutResult | null>>;
  /** renderer가 보낸 값을 검증해 원자 교체로 쓴다. 검증에 실패하면 `invalid_input`이고 파일은 그대로다. */
  write(
    workspace: string,
    layout: unknown,
  ): Promise<WorkspaceStoreResult<null>>;
  /** 지운 앱의 layout 파일을 지운다. 없으면 그대로 성공이다. */
  remove(workspace: string): Promise<WorkspaceStoreResult<null>>;
}

export function createWorkspaceLayoutStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): WorkspaceLayoutStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  const fileOf = (workspace: string) =>
    join(dataRoot, "shell", "workspaces", `${workspace}.json`);

  return {
    async read(workspace) {
      if (!isWorkspaceKey(workspace)) return INVALID_WORKSPACE;
      let raw: Uint8Array | null = null;
      try {
        raw = await impl.readFile(fileOf(workspace));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          return {
            ok: false,
            error: fsError(
              code === "EISDIR" ? "not_a_directory" : "unreadable",
            ),
          };
        }
      }
      if (raw === null) return { ok: true, value: null };
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
        return { ok: true, value: parseWorkspaceLayoutFile(parsed) };
      } catch {
        return { ok: true, value: { ok: false, reason: "corrupt" } };
      }
    },
    async remove(workspace) {
      if (!isWorkspaceKey(workspace)) return INVALID_WORKSPACE;
      try {
        await impl.unlink(fileOf(workspace));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return { ok: false, error: fsError("unwritable") };
        }
      }
      return { ok: true, value: null };
    },
    async write(workspace, layout) {
      if (!isWorkspaceKey(workspace)) return INVALID_WORKSPACE;
      const valid = validateWorkspaceLayout(layout);
      if (!valid.ok) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "invalid layout" },
        };
      }
      return writeFileAtomic(
        fileOf(workspace),
        JSON.stringify(valid.layout),
        impl,
      );
    },
  };
}
