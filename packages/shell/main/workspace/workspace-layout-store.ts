// <home>/shell/workspaces/<workspace>.json은 main만 쓴다(원자 교체와 mode는 atomic-file.ts). workspace는 `home`이거나
// project id, app id다. 파일이 없으면 null(기본 layout)이다. 손상된 파일은 읽을 때 `<workspace>.json.bak`으로 한 벌 남긴다.
// 옛 layouts/<prj_id>.json은 읽지 않는다.
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
  LEGACY_COMMAND_LAYOUT_VERSION,
  type LegacyQuickCommand,
  parseLegacyV13Layout,
  parseWorkspaceLayoutFile,
  validateWorkspaceLayout,
  type WorkspaceLayoutResult,
} from "./workspace-layout.ts";

export type WorkspaceLayoutStoreDeps = Partial<StoreDeps> & {
  /**
   * 판 13 layout의 `commands`를 core(`project_commands/import`)로 옮긴다.
   * 성공(true)하면 판 14로 저장해 `commands`를 지우고, 실패(false)하면 판 13 파일을 유지해 다음에 다시 시도한다.
   */
  migrateCommands?: (
    project: string,
    commands: readonly LegacyQuickCommand[],
  ) => Promise<boolean>;
};

const LOCAL_PROJECT_KEY = /^prj_[A-Za-z0-9]+$/;

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
  deps: WorkspaceLayoutStoreDeps = {},
): WorkspaceLayoutStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  const fileOf = (workspace: string) =>
    join(dataRoot, "shell", "workspaces", `${workspace}.json`);
  // 옮기기가 실패한 project의 옛 commands를 들고 있어 이후 write가 v13 commands를 지우지 않게 한다.
  const pendingCommands = new Map<string, readonly LegacyQuickCommand[]>();

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
      const text = new TextDecoder().decode(raw);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        await writeFileAtomic(`${fileOf(workspace)}.bak`, text, impl);
        return { ok: true, value: { ok: false, reason: "corrupt" } };
      }

      if (
        typeof parsedJson === "object" &&
        parsedJson !== null &&
        (parsedJson as { schema_version?: unknown }).schema_version ===
          LEGACY_COMMAND_LAYOUT_VERSION
      ) {
        const legacy = parseLegacyV13Layout(parsedJson);
        if (legacy === null) {
          await writeFileAtomic(`${fileOf(workspace)}.bak`, text, impl);
          return { ok: true, value: { ok: false, reason: "corrupt" } };
        }
        const needsImport =
          legacy.commands.length > 0 && LOCAL_PROJECT_KEY.test(workspace);
        if (needsImport) {
          let migrated = false;
          if (deps.migrateCommands !== undefined) {
            try {
              migrated = await deps.migrateCommands(workspace, legacy.commands);
            } catch {
              migrated = false;
            }
          }
          if (!migrated) {
            pendingCommands.set(workspace, legacy.commands);
            return { ok: true, value: { ok: true, layout: legacy.layout } };
          }
        }
        pendingCommands.delete(workspace);
        await writeFileAtomic(
          fileOf(workspace),
          JSON.stringify(legacy.layout),
          impl,
        );
        return { ok: true, value: { ok: true, layout: legacy.layout } };
      }

      const value: WorkspaceLayoutResult = parseWorkspaceLayoutFile(parsedJson);
      // 손상된 파일은 renderer가 기본 layout으로 덮는다. 덮기 전 값을 한 벌 남겨 손으로 되살릴 길을 둔다.
      if (!value.ok && value.reason === "corrupt") {
        await writeFileAtomic(`${fileOf(workspace)}.bak`, text, impl);
      }
      return { ok: true, value };
    },
    async remove(workspace) {
      if (!isWorkspaceKey(workspace)) return INVALID_WORKSPACE;
      pendingCommands.delete(workspace);
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
      const pending = pendingCommands.get(workspace);
      if (pending !== undefined && pending.length > 0) {
        let migrated = false;
        if (deps.migrateCommands !== undefined) {
          try {
            migrated = await deps.migrateCommands(workspace, pending);
          } catch {
            migrated = false;
          }
        }
        if (migrated) {
          pendingCommands.delete(workspace);
        } else {
          // 아직 옮기지 못했으므로 판 13 + commands를 보존해 다음 기동에 다시 옮긴다.
          return writeFileAtomic(
            fileOf(workspace),
            JSON.stringify({
              ...valid.layout,
              schema_version: LEGACY_COMMAND_LAYOUT_VERSION,
              commands: pending,
            }),
            impl,
          );
        }
      }
      return writeFileAtomic(
        fileOf(workspace),
        JSON.stringify(valid.layout),
        impl,
      );
    },
  };
}
