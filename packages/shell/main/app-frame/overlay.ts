import {
  fullBody,
  inside,
  interactive,
  modal,
  overlayCloseSchema,
  type OverlayEvent,
  type OverlayIdentity,
  type OverlayOpen,
  overlayOpenSchema,
  type OverlayOutcome,
  type OverlayReply,
  type OverlayResult,
  overlayResultSchema,
  type OverlaySnapshot,
  overlayUpdateSchema,
  type Rect,
  rectSchema,
} from "../../ipc/overlay.ts";
import {
  type CallerContents,
  ContentsRegistry,
  guardIpc,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import { type WebPreferences, webPreferences } from "../desktop/security.ts";
import {
  focusSurface,
  type HeadlessMode,
  SHELL_OFF,
} from "../desktop/headless.ts";
import { latestFrame } from "./frame.ts";
import { type ViewHost, viewOrder } from "./view-order.ts";

// notification은 focus를 옮기지 않지만 toast 행동은 고른 결과를 돌려준다. tooltip·drag는 고를 것이 없다.
function selectable(kind: OverlayOpen["kind"]): boolean {
  return interactive(kind) || kind === "notification";
}

const OVERLAY_URL = "lophn-shell://overlay/index.html";
export interface OverlayContents extends CallerContents {
  loadURL(url: string): Promise<void>;
  send(
    channel: "overlay:state" | "shell:overlay-result",
    event: OverlayEvent,
  ): void;
  focus(): void;
  close(): void;
}
export interface OverlayView {
  webContents: OverlayContents;
  onFailure(listener: (reason: "crashed" | "load_failed") => void): () => void;
  setBackgroundColor(color: string): void;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}
interface OverlayOptions {
  shell: OverlayContents;
  registry: ContentsRegistry;
  host: ViewHost<OverlayView>;
  create(
    config: { webPreferences: WebPreferences & { preload: string } },
  ): OverlayView;
  preload: string;
  packaged: boolean;
  /** 개발 확인 전용 headless. 켜지면 focus를 옮기지 않는다. */
  headless?: HeadlessMode;
  body(): Rect;
  timer: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}
type Surface = OverlayOpen & OverlayIdentity & {
  ending?: boolean;
};
const failure = (
  code: "invalid_input" | "forbidden" | "conflict" | "unavailable",
  message: string,
): OverlayReply<never> => ({ ok: false, error: { code, message } });
const success = <T>(value: T): OverlayReply<T> => ({ ok: true, value });

export function createOverlay(options: OverlayOptions) {
  const headless = options.headless ?? SHELL_OFF;
  const order = viewOrder(options.host);
  const surfaces = new Map<string, Surface>();
  let generation = 0;
  let serial = 0;
  let view: OverlayView;
  let ready = false;
  let disposed = false;
  let available = true;
  let attached = false;
  let release: (() => void) | undefined;
  let pendingId: string | undefined;
  const dragFrame = latestFrame(
    options.timer,
    (latest: { id: string; bounds: Rect; generation: number }) => {
      pendingId = undefined;
      if (disposed || !available || latest.generation !== generation) return;
      const owner = surfaces.get(latest.id);
      if (!owner) return;
      if (!inside(latest.bounds, options.body())) {
        finish(owner, "cancelled");
        sync();
        return;
      }
      if (!options.shell.isDestroyed()) {
        options.shell.send("shell:overlay-result", {
          requestId: owner.requestId,
          surfaceId: owner.surfaceId,
          generation: owner.generation,
          type: "pointer",
          bounds: latest.bounds,
        });
      }
      if (owner.ending) {
        finish(owner, "completed");
        sync();
      }
    },
  );
  const resizeFrame = latestFrame(options.timer, (epoch: number) => {
    if (disposed || !available || epoch !== generation) return;
    for (const surface of [...surfaces.values()]) {
      if (!inside(surface.anchorRect, options.body())) {
        finish(surface, "dismissed");
      }
    }
    sync();
  });
  function cancelDrag() {
    dragFrame.cancel();
    pendingId = undefined;
  }
  // scrim 표면이 떠 있는지 바뀔 때만 shell renderer에 알린다. 상단 바가 scrim을 같이 받는다.
  let modalOpen = false;
  function announceModal() {
    const open = [...surfaces.values()].some((surface) => modal(surface.kind));
    if (open === modalOpen) return;
    modalOpen = open;
    if (!options.shell.isDestroyed()) {
      options.shell.send(
        "shell:overlay-result",
        { type: "modal", open } satisfies OverlayEvent,
      );
    }
  }
  function finish(
    surface: Surface,
    reason: OverlayOutcome["reason"],
    choiceId?: string,
  ) {
    surfaces.delete(surface.surfaceId);
    announceModal();
    if (pendingId === surface.surfaceId) cancelDrag();
    if (!options.shell.isDestroyed()) {
      options.shell.send("shell:overlay-result", {
        requestId: surface.requestId,
        surfaceId: surface.surfaceId,
        generation: surface.generation,
        type: choiceId ? "selected" : "closed",
        ...(choiceId ? { choiceId } : { reason }),
      });
      if (
        interactive(surface.kind) &&
        ![...surfaces.values()].some((item) => interactive(item.kind))
      ) focusSurface(options.shell, headless);
    }
  }
  function snapshot(): OverlaySnapshot {
    const body = options.body();
    const all = [...surfaces.values()];
    let bounds = { ...body, width: 1, height: 1 };
    if (all.some((surface) => fullBody(surface.kind))) bounds = body;
    else if (all.length) {
      const x = Math.min(...all.map((s) => s.anchorRect.x));
      const y = Math.min(...all.map((s) => s.anchorRect.y));
      bounds = {
        x,
        y,
        width: Math.max(...all.map((s) =>
          s.anchorRect.x + s.anchorRect.width
        )) - x,
        height: Math.max(...all.map((s) =>
          s.anchorRect.y + s.anchorRect.height
        )) - y,
      };
    }
    return {
      generation,
      bounds,
      surfaces: all.map((surface) => {
        const rect = surface.kind === "drag" ? body : surface.anchorRect;
        return {
          ...surface,
          rect: { ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y },
        };
      }),
    };
  }
  function sync() {
    if (disposed || !available) return;
    resizeFrame.cancel();
    announceModal();
    const state = snapshot();
    view.setBounds(state.bounds);
    view.setVisible(state.surfaces.length > 0);
    order.raise();
    if (ready) view.webContents.send("overlay:state", state);
  }
  function retire(reason: OverlayOutcome["reason"]) {
    ready = false;
    resizeFrame.cancel();
    cancelDrag();
    for (const surface of [...surfaces.values()]) finish(surface, reason);
    release?.();
    release = undefined;
    options.registry.unregister(view.webContents.id);
    if (!attached) return;
    attached = false;
    order.remove(view);
    view.setVisible(false);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  function create() {
    generation++;
    ready = false;
    available = true;
    const current = options.create({
      webPreferences: {
        ...webPreferences(options.packaged),
        preload: options.preload,
      },
    });
    view = current;
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    options.registry.register({
      contents: view.webContents,
      origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
    });
    order.overlay(view);
    attached = true;
    const epoch = generation;
    const failed = (reason: "crashed" | "load_failed") => {
      if (disposed || epoch !== generation || !available) return;
      available = false;
      retire(reason);
      if (reason === "crashed") create();
    };
    release = view.onFailure(failed);
    void current.webContents.loadURL(OVERLAY_URL).catch(() =>
      failed("load_failed")
    );
  }
  function authorize<T>(
    event: IpcEvent,
    schema: Parameters<typeof guardIpc<T>>[2],
    input: unknown,
    kind: "shell" | "overlay",
  ) {
    const result = guardIpc(options.registry, event, schema, input);
    if (!result.ok) return result;
    const expected = kind === "shell" ? options.shell : view.webContents;
    if (disposed || !available || event.sender !== expected) {
      return failure(
        "forbidden",
        "caller is not this window's live surface owner",
      );
    }
    return result;
  }
  create();
  return {
    get generation() {
      return generation;
    },
    owns(contents: CallerContents) {
      return contents === options.shell || contents === view.webContents;
    },
    attach: order.attach,
    // 앱 view를 창에 붙인 뒤 부른다. overlay를 다시 맨 위로 둔다.
    raise: order.raise,
    refresh() {
      if (!disposed && available) resizeFrame.schedule(generation);
    },
    subscribe(event: IpcEvent, input: unknown): OverlayReply<null> {
      const checked = guardIpc(
        options.registry,
        event,
        rectSchema.pick({}),
        input,
      );
      if (!checked.ok) return checked;
      if (event.sender !== view.webContents || disposed || !available) {
        return failure("forbidden", "caller is not this window's overlay");
      }
      ready = true;
      sync();
      return success(null);
    },
    open(event: IpcEvent, input: unknown): OverlayReply<OverlayIdentity> {
      const checked = authorize(event, overlayOpenSchema, input, "shell");
      if (!checked.ok) return checked;
      if (!inside(checked.value.anchorRect, options.body())) {
        return failure("invalid_input", "anchor is outside window body");
      }
      if (
        surfaces.size >= 32 ||
        [...surfaces.values()].some((s) =>
          s.requestId === checked.value.requestId
        )
      ) {
        return failure(
          "conflict",
          "surface request is already active or capacity reached",
        );
      }
      if (
        checked.value.kind === "drag" &&
        [...surfaces.values()].some((s) => s.kind === "drag")
      ) return failure("conflict", "drag is already active");
      const identity = { surfaceId: `surface_${++serial}`, generation };
      surfaces.set(identity.surfaceId, { ...checked.value, ...identity });
      sync();
      if (interactive(checked.value.kind)) {
        focusSurface(view.webContents, headless);
      }
      return success(identity);
    },
    close(event: IpcEvent, input: unknown): OverlayReply<null> {
      const checked = authorize(event, overlayCloseSchema, input, "shell");
      if (!checked.ok) return checked;
      const surface = surfaces.get(checked.value.surfaceId);
      if (!surface || surface.generation !== checked.value.generation) {
        return failure("conflict", "surface is stale");
      }
      finish(surface, surface.kind === "drag" ? "cancelled" : "dismissed");
      sync();
      return success(null);
    },
    update(event: IpcEvent, input: unknown): OverlayReply<null> {
      const checked = authorize(event, overlayUpdateSchema, input, "shell");
      if (!checked.ok) return checked;
      const surface = surfaces.get(checked.value.surfaceId);
      if (!surface || surface.generation !== checked.value.generation) {
        return failure("conflict", "surface is stale");
      }
      if (surface.kind !== "palette" || !surface.model.search) {
        return failure("invalid_input", "surface does not search");
      }
      // 고르기 검사도 새 행으로 한다. 옛 행의 id는 더 고를 수 없다.
      surface.model = checked.value.model;
      sync();
      return success(null);
    },
    result(event: IpcEvent, input: unknown): OverlayReply<null> {
      const checked = authorize(event, overlayResultSchema, input, "overlay");
      if (!checked.ok) return checked;
      const result: OverlayResult = checked.value;
      const surface = surfaces.get(result.surfaceId);
      if (!surface || surface.generation !== result.generation) {
        return failure("conflict", "surface is stale");
      }
      if (result.type === "query") {
        // 검색 palette만 검색어를 연 쪽에 돌려준다. 표면은 열린 채이고 focus도 그대로다.
        if (surface.kind !== "palette" || !surface.model.search) {
          return failure("invalid_input", "surface does not search");
        }
        if (!options.shell.isDestroyed()) {
          options.shell.send("shell:overlay-result", {
            requestId: surface.requestId,
            surfaceId: surface.surfaceId,
            generation: surface.generation,
            type: "query",
            text: result.text,
          });
        }
      } else if (result.type === "drag-cancel") {
        if (surface.kind !== "drag") {
          return failure("invalid_input", "surface is not a drag");
        }
        finish(surface, "cancelled");
        sync();
      } else if (result.type === "pointer" || result.type === "drag-end") {
        if (
          surface.kind !== "drag" || !inside(result.bounds, options.body()) ||
          !inside(
            { x: result.x, y: result.y, width: 1, height: 1 },
            options.body(),
          )
        ) return failure("invalid_input", "pointer is outside drag body");
        if (surface.ending) return failure("conflict", "drag is ending");
        if (result.type === "drag-end") surface.ending = true;
        pendingId = surface.surfaceId;
        dragFrame.schedule({
          id: surface.surfaceId,
          bounds: result.bounds,
          generation,
        });
      } else {
        if (
          result.type === "selected" &&
          (!selectable(surface.kind) ||
            !surface.model.choices.some((choice) =>
              choice.id === result.choiceId && !choice.disabled
            ))
        ) return failure("invalid_input", "choice is not selectable");
        finish(
          surface,
          surface.kind === "drag" ? "cancelled" : "dismissed",
          result.type === "selected" ? result.choiceId : undefined,
        );
        sync();
      }
      return success(null);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retire("window_closed");
    },
  };
}
export type OverlayController = ReturnType<typeof createOverlay>;
