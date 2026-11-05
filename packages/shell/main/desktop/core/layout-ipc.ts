// workspace(Home, project, app)의 layout 저장·복원. desktop 창 본문만 부른다. renderer는 탭을 보내고,
// detached 창 bounds와 schema 판은 여기서 채운 뒤 파일 schema로 검사한다. desktop 창 자리는 layout에 두지 않는다
// (`workspace/window-state.ts`).
import { z } from "zod";

import {
  WORKSPACE_LAYOUT_READ_CHANNEL,
  WORKSPACE_LAYOUT_SAVE_CHANNEL,
  type WorkspaceLayoutReadResult,
  type WorkspaceLayoutSaveResult,
} from "../../../ipc/workspace.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import type { WorkspaceLayoutStore } from "../../workspace/workspace-layout-store.ts";
import type { WindowBounds } from "../../workspace/schema.ts";

const workspaceReadInput = z.strictObject({ workspace: z.string() });

const workspaceSaveInput = z.strictObject({
  workspace: z.string(),
  layout: z.strictObject({
    active_desk: z.string(),
    desks: z.record(
      z.string(),
      z.looseObject({ detached: z.array(z.unknown()).optional() }),
    ),
  }),
});

interface LayoutIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

interface LayoutIpcDeps {
  registry: ContentsRegistry;
  workspaceStore: WorkspaceLayoutStore;
  /** 이 창에 딸린 살아 있는 detached 창의 bounds(탭 key별). 저장할 때 renderer가 보낸 값을 덮어쓴다. */
  detachedBounds(event: IpcEvent): ReadonlyMap<string, WindowBounds>;
}

export function registerLayoutIpc(
  ipc: LayoutIpcMain,
  deps: LayoutIpcDeps,
): void {
  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(deps.registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(
    WORKSPACE_LAYOUT_READ_CHANNEL,
    async (event, input): Promise<WorkspaceLayoutReadResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(workspaceReadInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const stored = await deps.workspaceStore.read(parsed.value.workspace);
      if (!stored.ok) {
        return {
          ok: false,
          code:
            stored.error.code === "invalid_input"
              ? "invalid_input"
              : "unavailable",
          message: "",
        };
      }
      if (stored.value === null || !stored.value.ok) {
        return {
          ok: true,
          available: false,
          reason: stored.value === null ? "absent" : stored.value.reason,
        };
      }
      return { ok: true, available: true, layout: stored.value.layout };
    },
  );

  ipc.handle(
    WORKSPACE_LAYOUT_SAVE_CHANNEL,
    async (event, input): Promise<WorkspaceLayoutSaveResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(workspaceSaveInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      // 살아 있는 detached 창의 bounds가 renderer가 아는 값보다 새롭다.
      const live = deps.detachedBounds(event);
      const { layout } = parsed.value;
      const desks = Object.fromEntries(
        Object.entries(layout.desks).map(([name, desk]) => [
          name,
          {
            ...desk,
            detached: (desk.detached ?? []).map((item) => {
              const key = (item as { tab?: { key?: unknown } } | null)?.tab
                ?.key;
              const bounds =
                typeof key === "string" ? live.get(key) : undefined;
              return bounds === undefined
                ? item
                : { ...(item as object), bounds };
            }),
          },
        ]),
      );
      const written = await deps.workspaceStore.write(parsed.value.workspace, {
        active_desk: layout.active_desk,
        desks,
      });
      if (written.ok) return { ok: true };
      return {
        ok: false,
        code:
          written.error.code === "invalid_input"
            ? "invalid_input"
            : "unavailable",
        message: "",
      };
    },
  );
}

export function removeLayoutIpc(ipc: LayoutIpcMain): void {
  ipc.removeHandler(WORKSPACE_LAYOUT_READ_CHANNEL);
  ipc.removeHandler(WORKSPACE_LAYOUT_SAVE_CHANNEL);
}
