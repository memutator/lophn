// 프로젝트 작업대의 layout 저장·복원. desktop 창 본문만 부른다. renderer는 탭을 보내고,
// detached 창 bounds와 schema 판은 여기서 채운 뒤 파일 schema로 검사한다. desktop 창 자리는 layout에 두지 않는다
// (`workspace/window-state.ts`).
import { z } from "zod";

import {
  LAYOUT_READ_CHANNEL,
  LAYOUT_SAVE_CHANNEL,
  type LayoutReadResult,
  type LayoutSaveResult,
  PLACE_LAYOUT_READ_CHANNEL,
  PLACE_LAYOUT_SAVE_CHANNEL,
  type PlaceLayoutReadResult,
  type PlaceLayoutSaveResult,
} from "../../../ipc/workspace.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import type { LayoutStore } from "../../workspace/layout-store.ts";
import type { PlaceLayoutStore } from "../../workspace/place-layout-store.ts";
import {
  MAX_PANES,
  SCHEMA_VERSION,
  toLayoutFile,
  validateLayout,
  type WindowBounds,
} from "../../workspace/layout.ts";

const projectId = z.string().regex(/^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const readInput = z.strictObject({ project: projectId });

const saveInput = z.strictObject({
  project: projectId,
  active_desk: z.string().min(1).max(200),
  desks: z
    .record(
      z.string().min(1).max(200),
      z.strictObject({
        panes: z.array(z.unknown()).min(1).max(MAX_PANES),
        layout: z.unknown(),
        focused_pane: z
          .number()
          .int()
          .min(0)
          .max(MAX_PANES - 1),
        floats: z.array(z.unknown()).max(20),
        detached: z
          .array(z.strictObject({ tab: z.unknown(), bounds: z.unknown() }))
          .max(20),
      }),
    )
    .refine((desks) => {
      const count = Object.keys(desks).length;
      return count >= 1 && count <= 200;
    }),
  rail_apps: z.array(z.unknown()).max(20),
});

const placeReadInput = z.strictObject({ place: z.string() });

const placeSaveInput = z.strictObject({
  place: z.string(),
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
  store: LayoutStore;
  placeStore: PlaceLayoutStore;
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
    LAYOUT_READ_CHANNEL,
    async (event, input): Promise<LayoutReadResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(readInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "unreadable", message: "" };
      }
      const stored = await deps.store.read(parsed.value.project);
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
      const live = deps.detachedBounds(event);
      const desks = Object.fromEntries(
        Object.entries(parsed.value.desks).map(([name, desk]) => [
          name,
          {
            ...desk,
            detached: desk.detached.map((item) => {
              const key = (item.tab as { key?: unknown } | null)?.key;
              const bounds =
                typeof key === "string" ? live.get(key) : undefined;
              return bounds === undefined ? item : { ...item, bounds };
            }),
          },
        ]),
      );
      const valid = validateLayout({
        schema_version: SCHEMA_VERSION,
        project: parsed.value.project,
        active_desk: parsed.value.active_desk,
        desks,
        rail_apps: parsed.value.rail_apps,
      });
      if (!valid.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const written = await deps.store.write(
        parsed.value.project,
        JSON.stringify(toLayoutFile(valid.layout)),
      );
      return written.ok
        ? { ok: true }
        : { ok: false, code: "unwritable", message: "" };
    },
  );

  ipc.handle(
    PLACE_LAYOUT_READ_CHANNEL,
    async (event, input): Promise<PlaceLayoutReadResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(placeReadInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const stored = await deps.placeStore.read(parsed.value.place);
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
    PLACE_LAYOUT_SAVE_CHANNEL,
    async (event, input): Promise<PlaceLayoutSaveResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(placeSaveInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      // project layout과 같이 살아 있는 detached 창의 bounds가 renderer가 아는 값보다 새롭다.
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
      const written = await deps.placeStore.write(parsed.value.place, {
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
  ipc.removeHandler(LAYOUT_READ_CHANNEL);
  ipc.removeHandler(LAYOUT_SAVE_CHANNEL);
  ipc.removeHandler(PLACE_LAYOUT_READ_CHANNEL);
  ipc.removeHandler(PLACE_LAYOUT_SAVE_CHANNEL);
}
