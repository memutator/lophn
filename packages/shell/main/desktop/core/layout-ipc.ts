// 프로젝트 작업대의 layout 저장·복원. desktop 창 본문만 부른다. renderer는 탭을 보내고,
// 창 bounds와 schema 판은 여기서 채운 뒤 파일 schema로 검사한다.
import { z } from "zod";

import {
  LAYOUT_READ_CHANNEL,
  LAYOUT_SAVE_CHANNEL,
  type LayoutReadResult,
  type LayoutSaveResult,
} from "../../../ipc/workspace.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import type { LayoutStore } from "../../workspace/layout-store.ts";
import {
  SCHEMA_VERSION,
  toLayoutFile,
  validateLayout,
  type WindowBounds,
} from "../../workspace/layout.ts";

const projectId = z.string().regex(/^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const readInput = z.strictObject({ project: projectId });

const saveInput = z.strictObject({
  project: projectId,
  last_space: z.string().min(1).max(80),
  panes: z.array(z.unknown()).min(1).max(2),
  split_ratio: z.number(),
  focused_pane: z.number().int().min(0).max(1),
  floats: z.array(z.unknown()).max(20),
  detached: z.array(z.strictObject({ tab: z.unknown(), bounds: z.unknown() }))
    .max(20),
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
  store: LayoutStore;
  /** 이 창의 bounds. 없거나 숫자가 아니면 기본 960×600이다. */
  bounds(event: IpcEvent): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

function clampInt(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampBounds(
  raw: { x: number; y: number; width: number; height: number } | null,
): WindowBounds {
  return {
    x: clampInt(raw?.x ?? 0, -32768, 32768, 0),
    y: clampInt(raw?.y ?? 0, -32768, 32768, 0),
    width: clampInt(raw?.width ?? 960, 1, 32768, 960),
    height: clampInt(raw?.height ?? 600, 1, 32768, 600),
  };
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
    LAYOUT_READ_CHANNEL,
    async (event, input): Promise<LayoutReadResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(readInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "unreadable", message: "" };
      }
      const stored = await deps.store.read();
      if (!stored.ok) {
        return { ok: false, code: "unreadable", message: "" };
      }
      if (stored.value === null || !stored.value.ok) {
        return {
          ok: true,
          available: false,
          reason: stored.value === null ? "absent" : stored.value.reason,
        };
      }
      if (stored.value.layout.project !== parsed.value.project) {
        return { ok: true, available: false, reason: "absent" };
      }
      return { ok: true, available: true, layout: stored.value.layout };
    },
  );

  ipc.handle(
    LAYOUT_SAVE_CHANNEL,
    async (event, input): Promise<LayoutSaveResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(saveInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const valid = validateLayout({
        schema_version: SCHEMA_VERSION,
        project: parsed.value.project,
        last_space: parsed.value.last_space,
        panes: parsed.value.panes,
        split_ratio: parsed.value.split_ratio,
        focused_pane: parsed.value.focused_pane,
        floats: parsed.value.floats,
        detached: parsed.value.detached,
        window_bounds: clampBounds(deps.bounds(event)),
      });
      if (!valid.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const written = await deps.store.write(
        JSON.stringify(toLayoutFile(valid.layout)),
      );
      return written.ok
        ? { ok: true }
        : { ok: false, code: "unwritable", message: "" };
    },
  );
}

export function removeLayoutIpc(ipc: LayoutIpcMain): void {
  ipc.removeHandler(LAYOUT_READ_CHANNEL);
  ipc.removeHandler(LAYOUT_SAVE_CHANNEL);
}
